import { sleep } from "../../shared/process.ts";
import { deriveInteractionText, normalizePaneText } from "../../shared/transcript.ts";
import type { TmuxClient } from "./client.ts";
import { submitTmuxSessionInput } from "./session-handshake.ts";

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
  let lastVisibleSnapshot = "";
  let detachedNotified = params.detachedAlready;

  if (params.prompt) {
    await submitTmuxSessionInput({
      tmux: params.tmux,
      sessionName: params.sessionName,
      text: params.prompt,
      promptSubmitDelayMs: params.promptSubmitDelayMs,
    });
  }

  while (true) {
    await sleep(params.updateIntervalMs);
    const snapshot = normalizePaneText(
      await params.tmux.capturePane(params.sessionName, params.captureLines),
    );
    const now = Date.now();

    if (snapshot !== previousSnapshot) {
      lastChangeAt = now;
      previousSnapshot = snapshot;
      const interactionSnapshot = deriveInteractionText(params.initialSnapshot, snapshot);
      if (interactionSnapshot && interactionSnapshot !== lastVisibleSnapshot) {
        sawChange = true;
        lastVisibleSnapshot = interactionSnapshot;
        await params.onRunning({
          snapshot: interactionSnapshot,
          fullSnapshot: snapshot,
          initialSnapshot: params.initialSnapshot,
        });
      }
    }

    if (!detachedNotified && now - params.startedAt >= params.maxRuntimeMs) {
      detachedNotified = true;
      await params.onDetached({
        snapshot: deriveInteractionText(params.initialSnapshot, previousSnapshot),
        fullSnapshot: previousSnapshot,
        initialSnapshot: params.initialSnapshot,
      });
    }

    if (sawChange && now - lastChangeAt >= params.idleTimeoutMs) {
      await params.onCompleted({
        snapshot: deriveInteractionText(params.initialSnapshot, previousSnapshot),
        fullSnapshot: previousSnapshot,
        initialSnapshot: params.initialSnapshot,
      });
      return;
    }

    if (!sawChange && now - params.startedAt >= params.noOutputTimeoutMs) {
      await params.onTimeout({
        snapshot: deriveInteractionText(params.initialSnapshot, previousSnapshot),
        fullSnapshot: previousSnapshot,
        initialSnapshot: params.initialSnapshot,
      });
      return;
    }
  }
}
