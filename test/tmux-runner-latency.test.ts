import { describe, expect, test } from "bun:test";
import type { TmuxClient } from "../src/runners/tmux/client.ts";
import {
  captureTmuxSessionIdentity,
  dismissTmuxTrustPromptIfPresent,
  submitTmuxSessionInput,
  TmuxBootstrapSessionLostError,
  tmuxPaneHasTrustPrompt,
  waitForTmuxSessionBootstrap,
} from "../src/runners/tmux/session-handshake.ts";
import { monitorTmuxRun } from "../src/runners/tmux/run-monitor.ts";

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

  test("tmuxPaneHasTrustPrompt ignores stale trust text left above a later Codex prompt", () => {
    const snapshot = [
      "Do you trust the contents of this directory?",
      "Press enter to continue",
      "",
      "╭────────────────────────────────────────────╮",
      "│ >_ OpenAI Codex (v0.121.0)                 │",
      "╰────────────────────────────────────────────╯",
      "",
      "› Explain this codebase",
      "",
      "  gpt-5.4 high · /tmp/workspaces/codex",
    ].join("\n");

    expect(tmuxPaneHasTrustPrompt(snapshot)).toBe(false);
  });

  test("waitForTmuxSessionBootstrap ignores stale trust text once a later prompt is visible", async () => {
    let captureCount = 0;
    const staleSnapshot = [
      "Do you trust the contents of this directory?",
      "Press enter to continue",
      "",
      "╭────────────────────────────────────────────╮",
      "│ >_ OpenAI Codex (v0.121.0)                 │",
      "╰────────────────────────────────────────────╯",
      "",
      "› Explain this codebase",
      "",
      "  gpt-5.4 high · /tmp/workspaces/codex",
    ].join("\n");
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        return captureCount === 1 ? staleSnapshot : "READY";
      },
      async sendKey() {
        throw new Error("trust dismissal should not be attempted for stale trust text");
      },
    } as unknown as TmuxClient;

    const result = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
      trustWorkspace: true,
    });

    expect(result).toEqual({
      status: "ready",
      snapshot: staleSnapshot,
    });
  });

  test("dismissTmuxTrustPromptIfPresent returns when trust text is stale history only", async () => {
    let captureCount = 0;
    const snapshot = [
      "Do you trust the contents of this directory?",
      "Press enter to continue",
      "",
      "╭────────────────────────────────────────────╮",
      "│ >_ OpenAI Codex (v0.121.0)                 │",
      "╰────────────────────────────────────────────╯",
      "",
      "› Explain this codebase",
      "",
      "  gpt-5.4 high · /tmp/workspaces/codex",
    ].join("\n");
    const fakeTmux = {
      async capturePane() {
        captureCount += 1;
        return snapshot;
      },
      async sendKey() {
        throw new Error("trust dismissal should not be attempted for stale trust text");
      },
    } as unknown as TmuxClient;

    await dismissTmuxTrustPromptIfPresent({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
    });

    expect(captureCount).toBe(1);
  });

  test("monitorTmuxRun polls quickly for the first visible output", async () => {
    let snapshot = "";
    let pasteVisible = false;
    let submitted = false;

    const fakeTmux = {
      async sendLiteral() {
        pasteVisible = true;
      },
      async sendKey() {
        if (pasteVisible) {
          submitted = true;
          snapshot = "READY\nFIRST";
        }
      },
      async getPaneState() {
        if (submitted) {
          return {
            cursorX: 0,
            cursorY: snapshot ? 1 : 0,
            historySize: snapshot ? 1 : 0,
          };
        }
        return pasteVisible
          ? {
              cursorX: 4,
              cursorY: 0,
              historySize: 0,
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

  test("monitorTmuxRun completes when the pane stays idle without any active timer", async () => {
    let captureIndex = 0;
    const completions: string[] = [];
    let entered = false;
    let literalVisible = false;

    const fakeTmux = {
      async sendLiteral() {
        literalVisible = true;
      },
      async sendKey() {
        entered = true;
      },
      async getPaneState() {
        return entered
          ? {
              cursorX: 0,
              cursorY: 1,
              historySize: 1,
            }
          : {
              cursorX: 4,
              cursorY: 0,
              historySize: 0,
            };
      },
      async capturePane() {
        const snapshots = literalVisible ? ["READY\nnoop", "READY\nnoop", "READY\nnoop"] : ["READY"];
        const snapshot = snapshots[Math.min(captureIndex, snapshots.length - 1)] ?? "";
        captureIndex += 1;
        return snapshot;
      },
    } as unknown as TmuxClient;

    await monitorTmuxRun({
      tmux: fakeTmux,
      sessionName: "test-session",
      prompt: "noop",
      promptSubmitDelayMs: 1,
      captureLines: 80,
      updateIntervalMs: 5,
      idleTimeoutMs: 15,
      noOutputTimeoutMs: 1_000,
      maxRuntimeMs: 10_000,
      startedAt: Date.now(),
      initialSnapshot: "READY",
      detachedAlready: false,
      onRunning: async () => undefined,
      onDetached: async () => undefined,
      onCompleted: async (update) => {
        completions.push(update.snapshot);
      },
    });

    expect(completions).toEqual([""]);
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

  test("monitorTmuxRun uses the latest prompt boundary when the baseline cannot overlap", async () => {
    const snapshots = [
      [
        "Previous answer from an older request.",
        "",
        "Done.",
        "",
        "› new request",
        "",
        "New draft line.",
        "",
        "• Working... (1s • esc to interrupt)",
      ].join("\n"),
      [
        "Previous answer from an older request.",
        "",
        "Done.",
        "",
        "› new request",
        "",
        "New final line.",
      ].join("\n"),
      [
        "Previous answer from an older request.",
        "",
        "Done.",
        "",
        "› new request",
        "",
        "New final line.",
      ].join("\n"),
    ];
    let captureIndex = 0;
    const runningSnapshots: string[] = [];
    const completedSnapshots: string[] = [];

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
      initialSnapshot: "unrelated stale baseline",
      detachedAlready: false,
      onRunning: async (update) => {
        runningSnapshots.push(update.snapshot);
      },
      onDetached: async () => undefined,
      onCompleted: async (update) => {
        completedSnapshots.push(update.snapshot);
      },
    });

    expect(runningSnapshots).toEqual([
      ["New draft line.", "", "• Working... (1s • esc to interrupt)"].join("\n"),
      "New final line.",
    ]);
    expect(completedSnapshots).toEqual(["New final line."]);
    expect(runningSnapshots.join("\n")).not.toContain("Previous answer");
    expect(completedSnapshots.join("\n")).not.toContain("Previous answer");
  });

  test("monitorTmuxRun keeps the live timer when codex shows an idle input prompt below it", async () => {
    const snapshots = [
      [
        "Previous answer from an older request.",
        "",
        "• Summarizing findings...",
        "",
        "• Working (5m 02s • esc to interrupt)",
        "",
        "› Write tests for @filename",
        "",
        "  gpt-5.5 high · ~/.clisbot/workspaces/default",
      ].join("\n"),
      [
        "Previous answer from an older request.",
        "",
        "• Summarizing findings...",
        "",
        "• Working (5m 04s • esc to interrupt)",
        "",
        "› Write tests for @filename",
        "",
        "  gpt-5.5 high · ~/.clisbot/workspaces/default",
      ].join("\n"),
      [
        "Previous answer from an older request.",
        "",
        "Final line.",
      ].join("\n"),
      [
        "Previous answer from an older request.",
        "",
        "Final line.",
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
      initialSnapshot: "unrelated stale baseline",
      detachedAlready: false,
      onRunning: async (update) => {
        runningSnapshots.push(update.snapshot);
      },
      onDetached: async () => undefined,
      onCompleted: async () => undefined,
    });

    expect(runningSnapshots[0]).toContain("• Summarizing findings...");
    expect(runningSnapshots[0]).toContain("• Working (5m 02s • esc to interrupt)");
    expect(runningSnapshots[0]).not.toContain("› Write tests");
    expect(runningSnapshots[1]).toContain("• Working (5m 04s • esc to interrupt)");
  });

  test("monitorTmuxRun uses the post-submit pane as the streaming baseline", async () => {
    let literalVisible = false;
    let entered = false;
    let enteredCaptureCount = 0;
    const runningSnapshots: string[] = [];

    const fakeTmux = {
      async sendLiteral() {
        literalVisible = true;
      },
      async sendKey() {
        entered = true;
      },
      async getPaneState() {
        return entered
          ? {
              cursorX: 0,
              cursorY: 2,
              historySize: 2,
            }
          : literalVisible
            ? {
                cursorX: 13,
                cursorY: 1,
                historySize: 1,
              }
            : {
                cursorX: 0,
                cursorY: 0,
                historySize: 0,
              };
      },
      async capturePane() {
        if (!literalVisible) {
          return "Previous final answer";
        }
        if (!entered) {
          return "Previous final answer\n› new request";
        }

        enteredCaptureCount += 1;
        if (enteredCaptureCount === 1) {
          return "Previous final answer\n› new request";
        }
        return [
          "Previous final answer",
          "› new request",
          "",
          "Working on the new request.",
        ].join("\n");
      },
    } as unknown as TmuxClient;

    await monitorTmuxRun({
      tmux: fakeTmux,
      sessionName: "test-session",
      prompt: "new request",
      promptSubmitDelayMs: 1,
      captureLines: 80,
      updateIntervalMs: 5,
      idleTimeoutMs: 15,
      noOutputTimeoutMs: 1_000,
      maxRuntimeMs: 10_000,
      startedAt: Date.now(),
      initialSnapshot: "Previous final answer",
      detachedAlready: false,
      onRunning: async (update) => {
        runningSnapshots.push(update.snapshot);
      },
      onDetached: async () => undefined,
      onCompleted: async () => undefined,
    });

    expect(runningSnapshots).toEqual(["Working on the new request."]);
  });

  test("monitorTmuxRun does not hide output that appears during submit confirmation", async () => {
    let literalVisible = false;
    let entered = false;
    let enteredCaptureCount = 0;
    const runningSnapshots: string[] = [];

    const fakeTmux = {
      async sendLiteral() {
        literalVisible = true;
      },
      async sendKey() {
        entered = true;
      },
      async getPaneState() {
        return entered
          ? {
              cursorX: 0,
              cursorY: 3,
              historySize: 3,
            }
          : literalVisible
            ? {
                cursorX: 5,
                cursorY: 1,
                historySize: 1,
              }
            : {
                cursorX: 0,
                cursorY: 0,
                historySize: 0,
              };
      },
      async capturePane() {
        if (!literalVisible) {
          return "Previous final answer";
        }
        if (!entered) {
          return "Previous final answer\n› ask";
        }

        enteredCaptureCount += 1;
        if (enteredCaptureCount <= 2) {
          return [
            "Previous final answer",
            "› ask",
            "",
            "First generated line.",
          ].join("\n");
        }
        return [
          "Previous final answer",
          "› ask",
          "",
          "First generated line.",
          "Second generated line.",
        ].join("\n");
      },
    } as unknown as TmuxClient;

    await monitorTmuxRun({
      tmux: fakeTmux,
      sessionName: "test-session",
      prompt: "ask",
      promptSubmitDelayMs: 1,
      captureLines: 80,
      updateIntervalMs: 5,
      idleTimeoutMs: 15,
      noOutputTimeoutMs: 1_000,
      maxRuntimeMs: 10_000,
      startedAt: Date.now(),
      initialSnapshot: "Previous final answer",
      detachedAlready: false,
      onRunning: async (update) => {
        runningSnapshots.push(update.snapshot);
      },
      onDetached: async () => undefined,
      onCompleted: async () => undefined,
    });

    expect(runningSnapshots).toEqual([
      "First generated line.",
      ["First generated line.", "Second generated line."].join("\n"),
    ]);
  });

  test("monitorTmuxRun keeps cumulative running output after the initial snapshot scrolls out", async () => {
    const initialSnapshot = "READY";
    const snapshots = [
      ["line 1", "line 2", "line 3", "line 4"].join("\n"),
      ["line 3", "line 4", "line 5", "line 6"].join("\n"),
      ["line 3", "line 4", "line 5", "line 6"].join("\n"),
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

    expect(runningSnapshots).toEqual([
      ["line 1", "line 2", "line 3", "line 4"].join("\n"),
      ["line 1", "line 2", "line 3", "line 4", "line 5", "line 6"].join("\n"),
    ]);
  });

  test("monitorTmuxRun replaces the running preview when the pane rewrites without overlap", async () => {
    const initialSnapshot = "READY";
    const snapshots = [
      ["draft 1", "draft 2"].join("\n"),
      [
        "final 1",
        "final 2",
        "final 3",
        "final 4",
        "final 5",
        "final 6",
        "final 7",
        "final 8",
        "final 9",
        "final 10",
      ].join("\n"),
      [
        "final 1",
        "final 2",
        "final 3",
        "final 4",
        "final 5",
        "final 6",
        "final 7",
        "final 8",
        "final 9",
        "final 10",
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

    expect(runningSnapshots).toEqual([
      ["draft 1", "draft 2"].join("\n"),
      [
        "...[2 more lines]",
        "final 3",
        "final 4",
        "final 5",
        "final 6",
        "final 7",
        "final 8",
        "final 9",
        "final 10",
      ].join("\n"),
    ]);
  });

  test("monitorTmuxRun keeps stable context when only a running timer line changes", async () => {
    const initialSnapshot = "READY";
    const snapshots = [
      [
        "Reviewed the queue rendering path.",
        "The visible status is owned by clisbot.",
        "Working... 1s",
      ].join("\n"),
      [
        "Reviewed the queue rendering path.",
        "The visible status is owned by clisbot.",
        "Working... 2s",
      ].join("\n"),
      [
        "Reviewed the queue rendering path.",
        "The visible status is owned by clisbot.",
        "Working... 2s",
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

    expect(runningSnapshots).toEqual([
      snapshots[0],
      snapshots[1],
    ]);
  });

  test("monitorTmuxRun does not replay already-streamed lines after a bounded rewrite shrinks", async () => {
    const initialSnapshot = "READY";
    const snapshots = [
      ["draft 1", "draft 2"].join("\n"),
      [
        "final 1",
        "final 2",
        "final 3",
        "final 4",
        "final 5",
        "final 6",
        "final 7",
        "final 8",
        "final 9",
        "final 10",
      ].join("\n"),
      [
        "final 1",
        "final 2",
        "final 3",
        "final 4",
        "final 5",
        "final 6",
        "final 7",
      ].join("\n"),
      [
        "final 1",
        "final 2",
        "final 3",
        "final 4",
        "final 5",
        "final 6",
        "final 7",
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

    expect(runningSnapshots).toEqual([
      ["draft 1", "draft 2"].join("\n"),
      [
        "...[2 more lines]",
        "final 3",
        "final 4",
        "final 5",
        "final 6",
        "final 7",
        "final 8",
        "final 9",
        "final 10",
      ].join("\n"),
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
