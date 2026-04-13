import { describe, expect, test } from "bun:test";
import type { TmuxClient } from "../src/runners/tmux/client.ts";
import {
  submitTmuxSessionInput,
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
    const snapshot = await waitForTmuxSessionBootstrap({
      tmux: fakeTmux,
      sessionName: "test-session",
      captureLines: 80,
      startupDelayMs: 500,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(snapshot).toBe("READY");
    expect(captureCount).toBe(2);
    expect(elapsedMs).toBeLessThan(400);
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
      onTimeout: async () => undefined,
    }).catch((error) => {
      if (!(error instanceof Error) || !error.message.startsWith("seen-running:")) {
        throw error;
      }

      return Number.parseInt(error.message.replace("seen-running:", ""), 10);
    });

    expect(seenRunningAt).toBeLessThan(700);
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
