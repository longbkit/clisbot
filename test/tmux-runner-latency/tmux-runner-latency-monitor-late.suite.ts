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

});
