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
  test("monitorTmuxRun accepts a trust prompt that appears after startup but before the first prompt submit", async () => {
    let snapshot = [
      "Do you trust the contents of this directory?",
      "Press enter to continue",
    ].join("\n");
    let trusted = false;
    let submitted = false;
    let state = {
      cursorX: 0,
      cursorY: 0,
      historySize: 0,
    };

    const fakeTmux = {
      async sendLiteral(_sessionName: string, text: string) {
        if (!trusted) {
          throw new Error("prompt pasted before trust acceptance");
        }
        snapshot = `${snapshot}\n› ${text}`;
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
        if (!trusted) {
          trusted = true;
          snapshot = "READY\n› ";
          state = {
            cursorX: 2,
            cursorY: 1,
            historySize: 1,
          };
          return;
        }
        submitted = true;
        snapshot = "READY\nPONG";
        state = {
          cursorX: 0,
          cursorY: 2,
          historySize: 2,
        };
      },
      async getPaneState() {
        return state;
      },
      async capturePane() {
        return snapshot;
      },
    } as unknown as TmuxClient;

    const completed = await monitorTmuxRun({
      tmux: fakeTmux,
      sessionName: "test-session",
      prompt: "ping",
      promptSubmitDelayMs: 1,
      trustWorkspace: true,
      startupDelayMs: 1,
      captureLines: 80,
      updateIntervalMs: 5,
      idleTimeoutMs: 15,
      noOutputTimeoutMs: 50,
      maxRuntimeMs: 10_000,
      startedAt: Date.now(),
      initialSnapshot: "READY\n› ",
      detachedAlready: false,
      onRunning: async () => undefined,
      onDetached: async () => undefined,
      onCompleted: async () => undefined,
    }).then(() => true);

    expect(completed).toBe(true);
    expect(trusted).toBe(true);
    expect(submitted).toBe(true);
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

  test("monitorTmuxRun clears a rehydrated idle run without waiting for pane changes", async () => {
    const completions: string[] = [];
    const fakeTmux = {
      async capturePane() {
        return "READY\n›";
      },
    } as unknown as TmuxClient;

    await monitorTmuxRun({
      tmux: fakeTmux,
      sessionName: "test-session",
      prompt: undefined,
      promptSubmitDelayMs: 1,
      captureLines: 80,
      updateIntervalMs: 10,
      idleTimeoutMs: 80,
      noOutputTimeoutMs: 1_000,
      maxRuntimeMs: 10_000,
      startedAt: Date.now(),
      initialSnapshot: "READY\n›",
      detachedAlready: false,
      onRunning: async () => undefined,
      onDetached: async () => undefined,
      onCompleted: async (update) => {
        completions.push(update.snapshot);
      },
    });

    expect(completions).toEqual([""]);
  });

  test("monitorTmuxRun ignores stale active timers once later output has settled", async () => {
    const snapshot = [
      "› request",
      "",
      "Older draft.",
      "",
      "• Working (5m 02s • esc to interrupt)",
      "",
      "Final answer.",
    ].join("\n");
    const completions: string[] = [];
    const fakeTmux = {
      async capturePane() {
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
      initialSnapshot: "› request\n\nOlder draft.",
      detachedAlready: false,
      onRunning: async () => undefined,
      onDetached: async () => undefined,
      onCompleted: async (update) => {
        completions.push(update.snapshot);
      },
    });

    expect(completions).toHaveLength(1);
    expect(completions[0]).toContain("Final answer.");
    expect(completions[0]).not.toContain("Working (5m 02s");
  });

  test("monitorTmuxRun does not leak the previous settled transcript into the first running preview", async () => {
    const initialSnapshot = [
      "Previous answer",
      "",
      "Done.",
    ].join("\n");
    const snapshots = [
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
      updateIntervalMs: 10,
      idleTimeoutMs: 80,
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

});
