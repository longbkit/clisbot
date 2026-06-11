import { describe, expect, test } from "bun:test";
import type { TmuxClient } from "../../src/runners/tmux/client.ts";
import {
  captureTmuxSessionIdentity,
  acceptTmuxTrustPromptIfPresent,
  submitTmuxSessionInput,
  TmuxBootstrapSessionLostError,
  tmuxPaneHasTrustPrompt,
  waitForTmuxSessionBootstrap,
} from "../../src/runners/tmux/session-handshake.ts";
import { monitorTmuxRun } from "../../src/runners/tmux/run-monitor.ts";

describe("tmux runner latency behavior", () => {
  test("submitTmuxSessionInput retries Enter once when pane state stays unchanged", async () => {
    let enterCount = 0;
    let state = {
      cursorX: 4,
      cursorY: 0,
      historySize: 0,
    };

    const fakeTmux = {
      async sendLiteral() {
        state = {
          cursorX: 8,
          cursorY: 0,
          historySize: 0,
        };
      },
      async sendKey() {
        enterCount += 1;
        if (enterCount >= 2) {
          state = {
            cursorX: 0,
            cursorY: 1,
            historySize: 1,
          };
        }
      },
      async getPaneState() {
        return state;
      },
      async capturePane() {
        return "";
      },
    } as unknown as TmuxClient;

    await expect(
      submitTmuxSessionInput({
        tmux: fakeTmux,
        sessionName: "test-session",
        text: "ping",
        promptSubmitDelayMs: 1,
      }),
    ).resolves.toEqual({ submittedSnapshot: "" });

    expect(enterCount).toBe(2);
  });

  test("submitTmuxSessionInput waits for multiline paste to settle before Enter", async () => {
    let pastePolls = 0;
    let enterCount = 0;
    let pasteSettled = false;
    let state = {
      cursorX: 2,
      cursorY: 13,
      historySize: 0,
    };

    const fakeTmux = {
      async sendLiteral() {
        pastePolls = 0;
        pasteSettled = false;
      },
      async sendKey() {
        enterCount += 1;
        if (!pasteSettled) {
          return;
        }
        state = {
          cursorX: 2,
          cursorY: 19,
          historySize: 8,
        };
      },
      async getPaneState() {
        if (!pasteSettled) {
          pastePolls += 1;
          if (pastePolls >= 3) {
            pasteSettled = true;
            state = {
              cursorX: 27,
              cursorY: 13,
              historySize: 0,
            };
          }
        }
        return state;
      },
      async capturePane() {
        return "";
      },
    } as unknown as TmuxClient;

    await expect(
      submitTmuxSessionInput({
        tmux: fakeTmux,
        sessionName: "test-session",
        text: "[clisbot steering message]\nReply with exactly PONG and nothing else.",
        promptSubmitDelayMs: 1,
      }),
    ).resolves.toEqual({ submittedSnapshot: "" });

    expect(enterCount).toBe(1);
    expect(pasteSettled).toBe(true);
    expect(state.historySize).toBe(8);
  });

  test("submitTmuxSessionInput revalidates paste visibility before Enter without re-pasting", async () => {
    let sendLiteralCount = 0;
    let capturePaneCount = 0;
    let enterCount = 0;
    let state = {
      cursorX: 4,
      cursorY: 0,
      historySize: 0,
    };
    let snapshot = "";

    const fakeTmux = {
      async sendLiteral() {
        sendLiteralCount += 1;
        snapshot = "ping";
      },
      async sendKey() {
        enterCount += 1;
        state = {
          cursorX: 0,
          cursorY: 1,
          historySize: 1,
        };
        snapshot = "ECHO ping";
      },
      async getPaneState() {
        return state;
      },
      async capturePane() {
        capturePaneCount += 1;
        return snapshot;
      },
    } as unknown as TmuxClient;

    await expect(
      submitTmuxSessionInput({
        tmux: fakeTmux,
        sessionName: "test-session",
        text: "ping",
        promptSubmitDelayMs: 1,
      }),
    ).resolves.toEqual({ submittedSnapshot: "ping" });

    expect(sendLiteralCount).toBe(1);
    expect(capturePaneCount).toBeGreaterThanOrEqual(2);
    expect(enterCount).toBe(1);
  });

  test("submitTmuxSessionInput fails when paste never becomes visible", async () => {
    let sendLiteralCount = 0;
    let capturePaneCount = 0;
    let enterCount = 0;
    const fakeTmux = {
      async sendLiteral() {
        sendLiteralCount += 1;
      },
      async sendKey() {
        enterCount += 1;
      },
      async getPaneState() {
        return {
          cursorX: 4,
          cursorY: 0,
          historySize: 0,
        };
      },
      async capturePane() {
        capturePaneCount += 1;
        return "";
      },
    } as unknown as TmuxClient;

    await expect(
      submitTmuxSessionInput({
        tmux: fakeTmux,
        sessionName: "test-session",
        text: "ping",
        promptSubmitDelayMs: 1,
      }),
    ).rejects.toThrow("tmux paste was not confirmed after 3 delivery attempts");

    expect(sendLiteralCount).toBe(3);
    expect(capturePaneCount).toBeGreaterThanOrEqual(2);
    expect(enterCount).toBe(0);
  });

  test("submitTmuxSessionInput retries paste delivery before sending Enter", async () => {
    let sendLiteralCount = 0;
    let enterCount = 0;
    let state = {
      cursorX: 4,
      cursorY: 0,
      historySize: 0,
    };
    const fakeTmux = {
      async sendLiteral() {
        sendLiteralCount += 1;
        if (sendLiteralCount >= 3) {
          state = {
            cursorX: 8,
            cursorY: 0,
            historySize: 0,
          };
        }
      },
      async sendKey() {
        enterCount += 1;
        state = {
          cursorX: 0,
          cursorY: 1,
          historySize: 1,
        };
      },
      async getPaneState() {
        return state;
      },
      async capturePane() {
        return "";
      },
    } as unknown as TmuxClient;

    await expect(
      submitTmuxSessionInput({
        tmux: fakeTmux,
        sessionName: "test-session",
        text: "hi",
        promptSubmitDelayMs: 1,
      }),
    ).resolves.toEqual({ submittedSnapshot: "" });

    expect(sendLiteralCount).toBe(3);
    expect(enterCount).toBe(1);
  });

  test("submitTmuxSessionInput nudges Enter again when the prompt stays pending in the composer", async () => {
    let enterCount = 0;
    let state = {
      cursorX: 4,
      cursorY: 0,
      historySize: 0,
    };
    let snapshot = "READY";

    const fakeTmux = {
      async sendLiteral() {
        state = {
          cursorX: 10,
          cursorY: 0,
          historySize: 0,
        };
        snapshot = "READY\n› ping";
      },
      async sendKey() {
        enterCount += 1;
        if (enterCount === 1) {
          // Enter landed as a newline inside the composer: the pane changes,
          // but the prompt text is still pending and was never submitted.
          state = {
            cursorX: 0,
            cursorY: 1,
            historySize: 0,
          };
          return;
        }
        state = {
          cursorX: 0,
          cursorY: 2,
          historySize: 2,
        };
        snapshot = "READY\n› ping\n• Working (esc to interrupt)";
      },
      async getPaneState() {
        return state;
      },
      async capturePane() {
        return snapshot;
      },
    } as unknown as TmuxClient;

    await expect(
      submitTmuxSessionInput({
        tmux: fakeTmux,
        sessionName: "test-session",
        text: "ping",
        promptSubmitDelayMs: 1,
      }),
    ).resolves.toEqual({ submittedSnapshot: "READY\n› ping" });

    expect(enterCount).toBe(2);
  });

  test("submitTmuxSessionInput fails when pane state never confirms submit", async () => {
    let sendLiteralCount = 0;
    let state = {
      cursorX: 4,
      cursorY: 0,
      historySize: 0,
    };
    let snapshot = "READY";
    const fakeTmux = {
      async sendLiteral() {
        sendLiteralCount += 1;
        state = {
          cursorX: 8,
          cursorY: 0,
          historySize: 0,
        };
        snapshot = "READY\nping";
      },
      async sendKey() {
        return;
      },
      async getPaneState() {
        return state;
      },
      async capturePane() {
        return snapshot;
      },
    } as unknown as TmuxClient;

    await expect(
      submitTmuxSessionInput({
        tmux: fakeTmux,
        sessionName: "test-session",
        text: "ping",
        promptSubmitDelayMs: 1,
      }),
    ).rejects.toThrow("tmux submit was not confirmed after Enter");

    expect(sendLiteralCount).toBe(1);
  });
});
