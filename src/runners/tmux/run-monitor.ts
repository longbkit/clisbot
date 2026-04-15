import { sleep } from "../../shared/process.ts";
import {
  appendInteractionText,
  deriveInteractionText,
  deriveRunningInteractionText,
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
  onTimeout: (params: {
    snapshot: string;
    fullSnapshot: string;
    initialSnapshot: string;
  }) => Promise<void>;
};

export async function monitorTmuxRun(params: TmuxRunMonitorParams) {
  let previousSnapshot = params.initialSnapshot;
  let lastChangeAt = Date.now();
  let sawChange = false;
  let cumulativeInteractionSnapshot = "";
  let detachedNotified = params.detachedAlready;
  let firstMeaningfulDeltaLogged = false;

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
    logLatencyDebug("tmux-submit-complete", params.timingContext, {
      sessionName: params.sessionName,
      promptSubmitDelayMs: params.promptSubmitDelayMs,
      submitElapsedMs: Date.now() - params.startedAt,
    });
  }

  while (true) {
    await sleep(sawChange ? params.updateIntervalMs : Math.min(params.updateIntervalMs, FIRST_OUTPUT_POLL_INTERVAL_MS));
    const snapshot = normalizePaneText(
      await params.tmux.capturePane(params.sessionName, params.captureLines),
    );
    const now = Date.now();

    if (snapshot !== previousSnapshot) {
      const priorSnapshot = previousSnapshot;
      lastChangeAt = now;
      previousSnapshot = snapshot;
      const interactionDelta = deriveRunningInteractionText(priorSnapshot, snapshot);
      const nextInteractionSnapshot = appendInteractionText(
        cumulativeInteractionSnapshot,
        interactionDelta,
      );
      if (
        nextInteractionSnapshot &&
        nextInteractionSnapshot !== cumulativeInteractionSnapshot
      ) {
        sawChange = true;
        cumulativeInteractionSnapshot = nextInteractionSnapshot;
        if (!firstMeaningfulDeltaLogged) {
          firstMeaningfulDeltaLogged = true;
          logLatencyDebug("tmux-first-meaningful-delta", params.timingContext, {
            sessionName: params.sessionName,
            elapsedMs: now - params.startedAt,
          });
        }
        await params.onRunning({
          snapshot: cumulativeInteractionSnapshot,
          fullSnapshot: snapshot,
          initialSnapshot: params.initialSnapshot,
        });
      }
    }

    if (!detachedNotified && now - params.startedAt >= params.maxRuntimeMs) {
      detachedNotified = true;
      await params.onDetached({
        snapshot:
          cumulativeInteractionSnapshot ||
          deriveInteractionText(params.initialSnapshot, previousSnapshot),
        fullSnapshot: previousSnapshot,
        initialSnapshot: params.initialSnapshot,
      });
    }

    if (sawChange && now - lastChangeAt >= params.idleTimeoutMs) {
      await params.onCompleted({
        snapshot:
          cumulativeInteractionSnapshot ||
          deriveInteractionText(params.initialSnapshot, previousSnapshot),
        fullSnapshot: previousSnapshot,
        initialSnapshot: params.initialSnapshot,
      });
      return;
    }

    if (!sawChange && now - params.startedAt >= params.noOutputTimeoutMs) {
      await params.onTimeout({
        snapshot:
          cumulativeInteractionSnapshot ||
          deriveInteractionText(params.initialSnapshot, previousSnapshot),
        fullSnapshot: previousSnapshot,
        initialSnapshot: params.initialSnapshot,
      });
      return;
    }
  }
}
