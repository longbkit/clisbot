import { describe, expect, test } from "bun:test";
import type { TmuxClient } from "../src/runners/tmux/client.ts";
import {
  dismissTmuxTrustPromptIfPresent,
  submitTmuxSessionInput,
  TmuxBootstrapSessionLostError,
  waitForTmuxSessionBootstrap,
} from "../src/runners/tmux/session-handshake.ts";
import { monitorTmuxRun } from "../src/runners/tmux/run-monitor.ts";

describe("tmux runner latency behavior", () => {
  test("waitForTmuxSessionBootstrap returns before the full startup budget once output appears", async () => {
    let captureCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        return captureCount >= 2 ? "READY" : "";
      },
    } as unknown as TmuxClient;

    const startedAt = Date.now();
    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(result).toEqual({
      status: "ready",
      snapshot: "READY",
    });
    expect(captureCount).toBe(2);
    expect(elapsedMs).toBeLessThan(400);
  });

  test("waitForTmuxSessionBootstrap honors a ready pattern instead of the first non-empty pane", async () => {
    let captureCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        if (captureCount === 1) {
          return "Waiting for authentication...";
        }
        if (captureCount === 2) {
          return "Still booting...";
        }
        return "Type your message or @path/to/file";
      },
    } as unknown as TmuxClient;

    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
      readyPattern: "Type your message or @path/to/file",
    });

    expect(result.status).toBe("ready");
    expect(result.snapshot).toContain("Type your message or @path/to/file");
    expect(captureCount).toBe(3);
  });

  test("waitForTmuxSessionBootstrap stops early on a configured startup blocker", async () => {
    let captureCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        return "Please visit the following URL to authorize the application:";
      },
    } as unknown as TmuxClient;

    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
      readyPattern: "Type your message or @path/to/file",
      blockers: [
        {
          pattern: "Please visit the following URL to authorize the application",
          message: "auth required",
        },
      ],
    });

    expect(result).toEqual({
      status: "blocked",
      snapshot: "Please visit the following URL to authorize the application:",
      message: "auth required",
    });
    expect(captureCount).toBe(1);
  });

  test("waitForTmuxSessionBootstrap returns timeout when ready pattern never appears", async () => {
    const fakeTmux = {
      async capturePane() {
        return "Still booting...";
      },
    } as unknown as TmuxClient;

    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 150,
      readyPattern: "Type your message or @path/to/file",
    });

    expect(result).toEqual({
      status: "timeout",
      snapshot: "Still booting...",
    });
  });

  test("waitForTmuxSessionBootstrap dismisses Gemini trust prompts before ready-pattern matching", async () => {
    let captureCount = 0;
    let trustDismissed = false;
    let enterCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        if (!trustDismissed) {
          return [
            "Skipping project agents due to untrusted folder. To enable, ensure that the project root is trusted.",
            "Do you trust the files in this folder?",
            "1. Trust folder (default)",
          ].join("\n");
        }
        return "Type your message or @path/to/file";
      },
      async sendKey(_sessionName: string, key: string) {
        if (key === "Enter") {
          enterCount += 1;
          trustDismissed = true;
        }
      },
    } as unknown as TmuxClient;

    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
      trustWorkspace: true,
      readyPattern: "Type your message or @path/to/file",
    });

    expect(result).toEqual({
      status: "ready",
      snapshot: "Type your message or @path/to/file",
    });
    expect(enterCount).toBe(1);
    expect(captureCount).toBeGreaterThanOrEqual(2);
  });

  test("waitForTmuxSessionBootstrap tolerates transient no-current-target races", async () => {
    let captureCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        if (captureCount === 1) {
          throw new Error("tmux capture-pane failed with code 1: no current target");
        }
        return "READY";
      },
    } as unknown as TmuxClient;

    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
    });

    expect(result).toEqual({
      status: "ready",
      snapshot: "READY",
    });
  });

  test("dismissTmuxTrustPromptIfPresent tolerates transient no-current-target races", async () => {
    let captureCount = 0;
    let enterCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        if (captureCount === 1) {
          return [
            "Quick safety check:",
            "❯ 1. Yes, I trust this folder",
            "Enter to confirm · Esc to cancel",
          ].join("\n");
        }
        if (captureCount === 2) {
          throw new Error("tmux capture-pane failed with code 1: no current target");
        }
        return "READY";
      },
      async sendKey(_sessionName: string, key: string) {
        if (key === "Enter") {
          enterCount += 1;
        }
      },
    } as unknown as TmuxClient;

    await dismissTmuxTrustPromptIfPresent({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
    });

    expect(enterCount).toBe(1);
    expect(captureCount).toBeGreaterThanOrEqual(3);
  });

  test("dismissTmuxTrustPromptIfPresent throws when tmux server disappears", async () => {
    let captureCount = 0;
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        if (captureCount === 1) {
          return [
            "Quick safety check:",
            "❯ 1. Yes, I trust this folder",
            "Enter to confirm · Esc to cancel",
          ].join("\n");
        }
        throw new Error(
          "tmux capture-pane failed with code 1: error connecting to /tmp/clisbot.sock (No such file or directory)",
        );
      },
      async sendKey() {
        return;
      },
    } as unknown as TmuxClient;

    await expect(
      dismissTmuxTrustPromptIfPresent({
        tmux: fakeTmux,
        sessionName: "test-session",
        captureLines: 80,
        startupDelayMs: 500,
      }),
    ).rejects.toBeInstanceOf(TmuxBootstrapSessionLostError);
  });

  test("monitorTmuxRun polls quickly for the first visible output", async () => {
    let snapshot = "";
    let submitted = false;

    const fakeTmux = {
      async sendLiteral() {
        submitted = true;
      },
      async sendKey() {
        if (submitted) {
          snapshot = "READY\nFIRST";
        }
      },
      async getPaneState() {
        return submitted
          ? {
              cursorX: 0,
              cursorY: snapshot ? 1 : 0,
              historySize: snapshot ? 1 : 0,
            }
          : {
              cursorX: 0,
              cursorY: 0,
              historySize: 0,
            };
      },
      async capturePane() {
        return snapshot;
      },
    } as unknown as TmuxClient;

    const startedAt = Date.now();
    const seenRunningAt = await monitorTmuxRun({
      tmux: fakeTmux,
      sessionName: "test-session",
      prompt: "ping",
      promptSubmitDelayMs: 1,
      captureLines: 80,
      updateIntervalMs: 1000,
      idleTimeoutMs: 5_000,
      noOutputTimeoutMs: 5_000,
      maxRuntimeMs: 10_000,
      startedAt,
      initialSnapshot: "",
      detachedAlready: false,
      onRunning: async () => {
        throw new Error(`seen-running:${Date.now() - startedAt}`);
      },
      onDetached: async () => undefined,
      onCompleted: async () => undefined,
    }).catch((error) => {
      if (!(error instanceof Error) || !error.message.startsWith("seen-running:")) {
        throw error;
      }

      return Number.parseInt(error.message.replace("seen-running:", ""), 10);
    });

    expect(seenRunningAt).toBeLessThan(700);
  });

  test("monitorTmuxRun treats no-output timeout as diagnostic only and waits for timer-driven activity", async () => {
    const snapshots = [
      "",
      "",
      "Thinking... (esc to cancel, 56s)",
      "Thinking... (esc to cancel, 57s)",
      "Done.",
      "Done.",
      "Done.",
    ];
    let captureIndex = 0;
    const runningSnapshots: string[] = [];
    const completions: string[] = [];

    const fakeTmux = {
      async capturePane() {
        const snapshot = snapshots[Math.min(captureIndex, snapshots.length - 1)] ?? "";
        captureIndex += 1;
        return snapshot;
      },
    } as unknown as TmuxClient;

    await monitorTmuxRun({
      tmux: fakeTmux,
      sessionName: "test-session",
      prompt: undefined,
      promptSubmitDelayMs: 1,
      captureLines: 80,
      updateIntervalMs: 5,
      idleTimeoutMs: 15,
      noOutputTimeoutMs: 1,
      maxRuntimeMs: 10_000,
      startedAt: Date.now(),
      initialSnapshot: "",
      detachedAlready: false,
      onRunning: async (update) => {
        runningSnapshots.push(update.snapshot);
      },
      onDetached: async () => undefined,
      onCompleted: async (update) => {
        completions.push(update.snapshot);
      },
    });

    expect(runningSnapshots).toEqual([
      "Thinking... (esc to cancel, 56s)",
      "Thinking... (esc to cancel, 57s)",
      "Done.",
    ]);
    expect(completions).toEqual(["Done."]);
  });

  test("monitorTmuxRun does not leak the previous settled transcript into the first running preview", async () => {
    const initialSnapshot = [
      "Previous answer",
      "",
      "Done.",
    ].join("\n");
    const snapshots = [
      initialSnapshot,
      [
        "Previous answer",
        "",
        "Done.",
        "",
        "Working... (1s) esc to interrupt",
      ].join("\n"),
      [
        "Previous answer",
        "",
        "Done.",
        "",
        "New draft line",
      ].join("\n"),
      [
        "Previous answer",
        "",
        "Done.",
        "",
        "New draft line",
      ].join("\n"),
    ];
    let captureIndex = 0;
    const runningSnapshots: string[] = [];

    const fakeTmux = {
      async capturePane() {
        const snapshot = snapshots[Math.min(captureIndex, snapshots.length - 1)] ?? "";
        captureIndex += 1;
        return snapshot;
      },
    } as unknown as TmuxClient;

    await monitorTmuxRun({
      tmux: fakeTmux,
      sessionName: "test-session",
      prompt: undefined,
      promptSubmitDelayMs: 1,
      captureLines: 80,
      updateIntervalMs: 5,
      idleTimeoutMs: 15,
      noOutputTimeoutMs: 1_000,
      maxRuntimeMs: 10_000,
      startedAt: Date.now(),
      initialSnapshot,
      detachedAlready: false,
      onRunning: async (update) => {
        runningSnapshots.push(update.snapshot);
      },
      onDetached: async () => undefined,
      onCompleted: async () => undefined,
    });

    expect(runningSnapshots[0]).not.toContain("Previous answer");
    expect(runningSnapshots[0]).toContain("Working... (1s) esc to interrupt");
    expect(runningSnapshots[runningSnapshots.length - 1]).toContain("New draft line");
    expect(runningSnapshots).toEqual([
      "Working... (1s) esc to interrupt",
      "New draft line",
    ]);
  });

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
    } as unknown as TmuxClient;

    await expect(
      submitTmuxSessionInput({
        tmux: fakeTmux,
        sessionName: "test-session",
        text: "ping",
        promptSubmitDelayMs: 1,
      }),
    ).resolves.toBeUndefined();

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
    } as unknown as TmuxClient;

    await expect(
      submitTmuxSessionInput({
        tmux: fakeTmux,
        sessionName: "test-session",
        text: "[clisbot steering message]\nReply with exactly PONG and nothing else.",
        promptSubmitDelayMs: 1,
      }),
    ).resolves.toBeUndefined();

    expect(enterCount).toBe(1);
    expect(pasteSettled).toBe(true);
    expect(state.historySize).toBe(8);
  });

  test("submitTmuxSessionInput fails when pane state never confirms submit", async () => {
    const fakeTmux = {
      async sendLiteral() {
        return;
      },
      async sendKey() {
        return;
      },
      async getPaneState() {
        return {
          cursorX: 8,
          cursorY: 0,
          historySize: 0,
        };
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
  });
});
