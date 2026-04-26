import { sleep } from "../../shared/process.ts";
import {
  appendInteractionText,
  deriveBoundedRunningRewritePreview,
  deriveInteractionText,
  deriveRunningInteractionText,
  deriveRunningInteractionSnapshot,
  hasActiveTimerStatus,
  normalizePaneText,
} from "../../shared/transcript.ts";
import type { TmuxClient } from "./client.ts";
import { submitTmuxSessionInput } from "./session-handshake.ts";
import { logLatencyDebug, type LatencyDebugContext } from "../../control/latency-debug.ts";

const FIRST_OUTPUT_POLL_INTERVAL_MS = 250;
const RUNNING_REWRITE_PREVIEW_MAX_LINES = 8;

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

function shouldUsePostSubmitBaseline(snapshot: string, prompt: string) {
  const trimmedPrompt = prompt.trim();
  return Boolean(trimmedPrompt) && snapshot.includes(trimmedPrompt);
}

export async function monitorTmuxRun(params: TmuxRunMonitorParams) {
  let baselineSnapshot = params.initialSnapshot;
  let previousSnapshot = params.initialSnapshot;
  let previousRunningTruth = "";
  let previousRenderedRunningSnapshot = "";
  let lastPaneChangeAt = params.startedAt;
  let sawActivity = false;
  let sawPaneChange = false;
  let sawPromptSubmission = Boolean(params.prompt);
  let detachedNotified = params.detachedAlready;
  let firstMeaningfulDeltaLogged = false;
  let noOutputThresholdLogged = false;

  if (params.prompt) {
    logLatencyDebug("tmux-submit-start", params.timingContext, {
      sessionName: params.sessionName,
      promptSubmitDelayMs: params.promptSubmitDelayMs,
    });
    const submitResult = await submitTmuxSessionInput({
      tmux: params.tmux,
      sessionName: params.sessionName,
      text: params.prompt,
      promptSubmitDelayMs: params.promptSubmitDelayMs,
      timingContext: params.timingContext,
    });
    if (
      submitResult.submittedSnapshot &&
      shouldUsePostSubmitBaseline(submitResult.submittedSnapshot, params.prompt)
    ) {
      baselineSnapshot = submitResult.submittedSnapshot;
      previousSnapshot = submitResult.submittedSnapshot;
    }
    sawPromptSubmission = true;
    lastPaneChangeAt = Date.now();
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
    const priorSnapshot = previousSnapshot;
    const paneChanged = snapshot !== previousSnapshot;
    if (paneChanged) {
      lastPaneChangeAt = now;
      sawPaneChange = true;
    }
    const hasActiveTimer = hasActiveTimerStatus(snapshot);
    const currentRunningSnapshot = deriveRunningInteractionSnapshot(snapshot);
    const baselineRunningSnapshot =
      deriveInteractionText(baselineSnapshot, snapshot) || currentRunningSnapshot;
    const runningDelta = priorSnapshot
      ? deriveRunningInteractionText(priorSnapshot, snapshot)
      : currentRunningSnapshot;
    const shouldReplaceRunningSnapshot =
      paneChanged &&
      !runningDelta &&
      Boolean(baselineRunningSnapshot) &&
      baselineRunningSnapshot !== previousRunningTruth;
    const nextRunningTruth = runningDelta
      ? previousRunningTruth
        ? appendInteractionText(previousRunningTruth, runningDelta)
        : runningDelta
      : shouldReplaceRunningSnapshot
        ? baselineRunningSnapshot
        : previousRunningTruth;
    const runningSnapshot = runningDelta
      ? nextRunningTruth
      : shouldReplaceRunningSnapshot
        ? deriveBoundedRunningRewritePreview({
            previousSnapshot: previousRunningTruth,
            snapshot: nextRunningTruth,
            maxLines: RUNNING_REWRITE_PREVIEW_MAX_LINES,
          })
        : "";

    previousSnapshot = snapshot;
    previousRunningTruth = nextRunningTruth;

    if (runningSnapshot && runningSnapshot !== previousRenderedRunningSnapshot) {
      previousRenderedRunningSnapshot = runningSnapshot;
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
        initialSnapshot: baselineSnapshot,
      });
    }

    if (!detachedNotified && now - params.startedAt >= params.maxRuntimeMs) {
      detachedNotified = true;
      await params.onDetached({
        snapshot:
          previousRenderedRunningSnapshot ||
          previousRunningTruth ||
          deriveInteractionText(baselineSnapshot, snapshot),
        fullSnapshot: previousSnapshot,
        initialSnapshot: baselineSnapshot,
      });
    }

    if (
      !hasActiveTimer &&
      (sawActivity || sawPaneChange || sawPromptSubmission) &&
      now - lastPaneChangeAt >= params.idleTimeoutMs
    ) {
      await params.onCompleted({
        snapshot: deriveInteractionText(baselineSnapshot, previousSnapshot),
        fullSnapshot: previousSnapshot,
        initialSnapshot: baselineSnapshot,
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
