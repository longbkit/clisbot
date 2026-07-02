import { describe, expect, test } from "bun:test";
import type { TmuxClient } from "../../src/runners/tmux/client.ts";
import {
  captureTmuxSessionIdentity,
} from "../../src/runners/tmux/identity-capture.ts";
import {
  acceptTmuxTrustPromptIfPresent,
  tmuxPaneHasTrustPrompt,
  waitForTmuxSessionBootstrap,
} from "../../src/runners/tmux/startup-prompts.ts";
import {
  submitTmuxSessionInput,
} from "../../src/runners/tmux/submit-input.ts";
import {
  TmuxBootstrapSessionLostError,
} from "../../src/runners/tmux/errors.ts";
import { monitorTmuxRun } from "../../src/runners/tmux/run-monitor.ts";

describe("tmux runner latency behavior", () => {
  test("captureTmuxSessionIdentity reads the session id from the fresh status output only", async () => {
    const staleId = "11111111-1111-1111-1111-111111111111";
    const currentId = "22222222-2222-2222-2222-222222222222";
    let snapshot = `old transcript mentions ${staleId}`;
    let state = {
      cursorX: 0,
      cursorY: 0,
      historySize: 0,
    };

    const fakeTmux = {
      async sendLiteral(_sessionName: string, text: string) {
        snapshot = `${snapshot}\n> ${text}`;
        state = {
          cursorX: text.length,
          cursorY: state.cursorY,
          historySize: state.historySize,
        };
      },
      async sendKey(_sessionName: string, key: string) {
        if (key !== "Enter") {
          return;
        }
        snapshot = `${snapshot.replace(/\n> \/status$/, "")}\nSTATUS session id: ${currentId}`;
        state = {
          cursorX: 0,
          cursorY: state.cursorY + 1,
          historySize: state.historySize + 1,
        };
      },
      async getPaneState() {
        return state;
      },
      async capturePane() {
        return snapshot;
      },
    } as unknown as TmuxClient;

    await expect(
      captureTmuxSessionIdentity({
        tmux: fakeTmux,
        sessionName: "test-session",
        promptSubmitDelayMs: 1,
        captureLines: 80,
        statusCommand: "/status",
        pattern:
          "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b",
        timeoutMs: 100,
        pollIntervalMs: 1,
      }),
    ).resolves.toBe(currentId);
  });

  test("captureTmuxSessionIdentity reads boxed Codex status output", async () => {
    const staleId = "11111111-1111-1111-1111-111111111111";
    const currentId = "019dd4ef-8e81-7410-a94b-90939550da64";
    let snapshot = `old transcript mentions ${staleId}\n› `;
    let state = {
      cursorX: 0,
      cursorY: 1,
      historySize: 0,
    };

    const fakeTmux = {
      async sendLiteral(_sessionName: string, text: string) {
        snapshot = `${snapshot}${text}`;
        state = {
          cursorX: text.length,
          cursorY: state.cursorY,
          historySize: state.historySize,
        };
      },
      async sendKey(_sessionName: string, key: string) {
        if (key !== "Enter") {
          return;
        }
        snapshot = [
          snapshot,
          "╭──────────────────────────────────────────────╮",
          "│ >_ OpenAI Codex (v0.125.0)                   │",
          "│  Session:              019dd4ef-8e81-7410-a94b-90939550da64  │",
          "╰──────────────────────────────────────────────╯",
          "",
        ].join("\n");
        state = {
          cursorX: 0,
          cursorY: state.cursorY + 5,
          historySize: state.historySize + 5,
        };
      },
      async getPaneState() {
        return state;
      },
      async capturePane() {
        return snapshot;
      },
    } as unknown as TmuxClient;

    await expect(
      captureTmuxSessionIdentity({
        tmux: fakeTmux,
        sessionName: "test-session",
        promptSubmitDelayMs: 1,
        captureLines: 80,
        statusCommand: "/status",
        pattern:
          "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b",
        timeoutMs: 100,
        pollIntervalMs: 1,
      }),
    ).resolves.toBe(currentId);
  });

  test("captureTmuxSessionIdentity falls back to the full redraw when diff candidates collapse to the echoed status command", async () => {
    const currentId = "019de81c-5978-79b3-8871-6173900a1107";
    let snapshot = [
      "previous assistant output",
      "• PONG",
      "",
      "/status",
      "╭──────────────────────────────────────────────────────────────────────────────╮",
      "│  Session:              019de81c-5978-79b3-8871-6173900a1107                  │",
      "╰──────────────────────────────────────────────────────────────────────────────╯",
      "",
      "› ",
    ].join("\n");
    let state = {
      cursorX: 0,
      cursorY: 8,
      historySize: 8,
    };

    const fakeTmux = {
      async sendLiteral(_sessionName: string, text: string) {
        snapshot = `${snapshot}${text}`;
        state = {
          cursorX: text.length,
          cursorY: state.cursorY,
          historySize: state.historySize,
        };
      },
      async sendKey(_sessionName: string, key: string) {
        if (key !== "Enter") {
          return;
        }
        snapshot = [
          "╭──────────────────────────────────────────────────────────────────────────────╮",
          "│  Session:              019de81c-5978-79b3-8871-6173900a1107                  │",
          "╰──────────────────────────────────────────────────────────────────────────────╯",
          "",
          "/status",
          "",
          "› /status",
          "",
          "  /status      show current session configuration and token usage",
        ].join("\n");
        state = {
          cursorX: 0,
          cursorY: 8,
          historySize: state.historySize + 1,
        };
      },
      async getPaneState() {
        return state;
      },
      async capturePane() {
        return snapshot;
      },
    } as unknown as TmuxClient;

    await expect(
      captureTmuxSessionIdentity({
        tmux: fakeTmux,
        sessionName: "test-session",
        promptSubmitDelayMs: 1,
        captureLines: 120,
        statusCommand: "/status",
        pattern:
          "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b",
        timeoutMs: 100,
        pollIntervalMs: 1,
      }),
    ).resolves.toBe(currentId);
  });

  test("captureTmuxSessionIdentity falls back when raw append has no session id", async () => {
    const currentId = "33333333-3333-3333-3333-333333333333";
    let snapshot = [
      "runner status",
      "stable footer line one",
      "stable footer line two",
    ].join("\n");
    let state = {
      cursorX: 0,
      cursorY: 2,
      historySize: 0,
    };

    const fakeTmux = {
      async sendLiteral(_sessionName: string, text: string) {
        state = {
          cursorX: text.length,
          cursorY: state.cursorY,
          historySize: state.historySize,
        };
      },
      async sendKey(_sessionName: string, key: string) {
        if (key !== "Enter") {
          return;
        }
        snapshot = [
          "runner status",
          `session id: ${currentId}`,
          "stable footer line one",
          "stable footer line two",
          "status command accepted",
        ].join("\n");
        state = {
          cursorX: 0,
          cursorY: state.cursorY + 1,
          historySize: state.historySize + 1,
        };
      },
      async getPaneState() {
        return state;
      },
      async capturePane() {
        return snapshot;
      },
    } as unknown as TmuxClient;

    await expect(
      captureTmuxSessionIdentity({
        tmux: fakeTmux,
        sessionName: "test-session",
        promptSubmitDelayMs: 1,
        captureLines: 80,
        statusCommand: "/status",
        pattern:
          "session id:\\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
        timeoutMs: 100,
        pollIntervalMs: 1,
      }),
    ).resolves.toBe(currentId);
  });

});
