import { sleep } from "../../shared/process.ts";
import {
  deriveInteractionText,
  deriveRunningInteractionSnapshot,
  normalizePaneText,
} from "../../shared/transcript.ts";
import type { TmuxClient } from "./client.ts";
import { submitTmuxSessionInput } from "./session-handshake.ts";
import { logLatencyDebug, type LatencyDebugContext } from "../../control/latency-debug.ts";

const FIRST_OUTPUT_POLL_INTERVAL_MS = 250;

export type TmuxRunMonitorParams = {
  tmux: TmuxClient;
  sessionName: string;
  prompt?: string;
  promptSubmitDelayMs: number;
  captureLines: number;
  updateIntervalMs: number;
  idleTimeoutMs: number;
  noOutputTimeoutMs: number;
  maxRuntimeMs: number;
  startedAt: number;
  initialSnapshot: string;
  detachedAlready: boolean;
  timingContext?: LatencyDebugContext;
  onPromptSubmitted?: () => Promise<void>;
  onRunning: (params: {
    snapshot: string;
    fullSnapshot: string;
    initialSnapshot: string;
  }) => Promise<void>;
  onDetached: (params: {
    snapshot: string;
    fullSnapshot: string;
    initialSnapshot: string;
  }) => Promise<void>;
  onCompleted: (params: {
    snapshot: string;
    fullSnapshot: string;
    initialSnapshot: string;
  }) => Promise<void>;
};

export async function monitorTmuxRun(params: TmuxRunMonitorParams) {
  let previousSnapshot = params.initialSnapshot;
  let previousRunningSnapshot = "";
  let lastActivityAt = params.startedAt;
  let sawActivity = false;
  let detachedNotified = params.detachedAlready;
  let firstMeaningfulDeltaLogged = false;
  let noOutputThresholdLogged = false;

  if (params.prompt) {
    logLatencyDebug("tmux-submit-start", params.timingContext, {
      sessionName: params.sessionName,
      promptSubmitDelayMs: params.promptSubmitDelayMs,
    });
    await submitTmuxSessionInput({
      tmux: params.tmux,
      sessionName: params.sessionName,
      text: params.prompt,
      promptSubmitDelayMs: params.promptSubmitDelayMs,
      timingContext: params.timingContext,
    });
    await params.onPromptSubmitted?.();
    logLatencyDebug("tmux-submit-complete", params.timingContext, {
      sessionName: params.sessionName,
      promptSubmitDelayMs: params.promptSubmitDelayMs,
      submitElapsedMs: Date.now() - params.startedAt,
    });
  }

  while (true) {
    await sleep(
      sawActivity
        ? params.updateIntervalMs
        : Math.min(params.updateIntervalMs, FIRST_OUTPUT_POLL_INTERVAL_MS),
    );
    const snapshot = normalizePaneText(
      await params.tmux.capturePane(params.sessionName, params.captureLines),
    );
    const now = Date.now();
    const runningSnapshot = deriveRunningInteractionSnapshot(snapshot);

    previousSnapshot = snapshot;

    if (runningSnapshot && runningSnapshot !== previousRunningSnapshot) {
      previousRunningSnapshot = runningSnapshot;
      lastActivityAt = now;
      sawActivity = true;
      if (!firstMeaningfulDeltaLogged) {
        firstMeaningfulDeltaLogged = true;
        logLatencyDebug("tmux-first-meaningful-delta", params.timingContext, {
          sessionName: params.sessionName,
          elapsedMs: now - params.startedAt,
        });
      }
      await params.onRunning({
        snapshot: runningSnapshot,
        fullSnapshot: snapshot,
        initialSnapshot: params.initialSnapshot,
      });
    }

    if (!detachedNotified && now - params.startedAt >= params.maxRuntimeMs) {
      detachedNotified = true;
      await params.onDetached({
        snapshot: previousRunningSnapshot || deriveInteractionText(params.initialSnapshot, snapshot),
        fullSnapshot: previousSnapshot,
        initialSnapshot: params.initialSnapshot,
      });
    }

    if (sawActivity && now - lastActivityAt >= params.idleTimeoutMs) {
      await params.onCompleted({
        snapshot: deriveInteractionText(params.initialSnapshot, previousSnapshot),
        fullSnapshot: previousSnapshot,
        initialSnapshot: params.initialSnapshot,
      });
      return;
    }

    if (!noOutputThresholdLogged && !sawActivity && now - params.startedAt >= params.noOutputTimeoutMs) {
      noOutputThresholdLogged = true;
      logLatencyDebug("tmux-no-output-threshold-crossed", params.timingContext, {
        sessionName: params.sessionName,
        elapsedMs: now - params.startedAt,
      });
    }
  }
}
