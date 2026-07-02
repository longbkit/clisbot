// tmux-side session-identity capture: submit the runner's status command into
// the pane and parse the runner-reported session id from fresh output. This
// only captures the id; persisting it stays with the session-owned continuity
// mapping above the tmux helpers.

import { parseRunnerSessionId } from "../../agents/session/session-identity.ts";
import { sleep } from "../../infra/process.ts";
import {
  deriveInteractionDiffText,
  deriveInteractionText,
  extractScrolledAppend,
  normalizePaneText,
} from "../transcript/index.ts";
import type { TmuxClient, TmuxPaneState } from "./client.ts";
import {
  buildBootstrapSessionLostError,
  isBootstrapSessionGoneError,
  isRetryableBootstrapTargetError,
} from "./errors.ts";
import { arePaneStatesEqual } from "./pane-state.ts";
import {
  acceptStartupContinuePrompt,
  acceptTmuxStartupContinuePromptIfPresent,
  tmuxPaneHasStartupContinuePrompt,
} from "./startup-prompts.ts";
import { submitTmuxSessionInput } from "./submit-input.ts";

const POST_STATUS_SETTLE_POLL_INTERVAL_MS = 40;
const POST_STATUS_SETTLE_QUIET_WINDOW_MS = 80;
const POST_STATUS_SETTLE_MAX_WAIT_MS = 240;

export async function captureTmuxSessionIdentity(params: {
  tmux: TmuxClient;
  sessionName: string;
  promptSubmitDelayMs: number;
  captureLines: number;
  statusCommand: string;
  pattern: string;
  timeoutMs: number;
  pollIntervalMs: number;
}) {
  await acceptTmuxStartupContinuePromptIfPresent({
    tmux: params.tmux,
    sessionName: params.sessionName,
    captureLines: params.captureLines,
    startupDelayMs: params.timeoutMs,
    trustWorkspace: true,
  });
  let statusSubmission = await submitTmuxSessionInput({
    tmux: params.tmux,
    sessionName: params.sessionName,
    text: params.statusCommand,
    promptSubmitDelayMs: params.promptSubmitDelayMs,
    timingContext: undefined,
  });
  let deadline = Date.now() + params.timeoutMs;

  while (Date.now() < deadline) {
    await sleep(params.pollIntervalMs);
    let snapshot = "";
    try {
      snapshot = normalizePaneText(
        await params.tmux.capturePane(params.sessionName, params.captureLines),
      );
    } catch (error) {
      if (isRetryableBootstrapTargetError(error)) {
        continue;
      }
      if (isBootstrapSessionGoneError(error)) {
        throw buildBootstrapSessionLostError(params.sessionName, error);
      }
      throw error;
    }
    if (tmuxPaneHasStartupContinuePrompt(snapshot, { trustWorkspace: true })) {
      await acceptStartupContinuePrompt({
        tmux: params.tmux,
        sessionName: params.sessionName,
        captureLines: params.captureLines,
        trustWorkspace: true,
      });
      deadline = Date.now() + params.timeoutMs;
      statusSubmission = await submitTmuxSessionInput({
        tmux: params.tmux,
        sessionName: params.sessionName,
        text: params.statusCommand,
        promptSubmitDelayMs: params.promptSubmitDelayMs,
        timingContext: undefined,
      });
      continue;
    }

    const sessionId = extractSessionIdFromCaptureCandidates(
      deriveSessionIdCaptureCandidates(
        statusSubmission.submittedSnapshot,
        snapshot,
        params.statusCommand,
      ),
      params.pattern,
    );
    if (sessionId) {
      await waitForTmuxPaneSettle({
        tmux: params.tmux,
        sessionName: params.sessionName,
        captureLines: params.captureLines,
        pollIntervalMs: POST_STATUS_SETTLE_POLL_INTERVAL_MS,
        quietWindowMs: POST_STATUS_SETTLE_QUIET_WINDOW_MS,
        maxWaitMs: POST_STATUS_SETTLE_MAX_WAIT_MS,
      });
      return sessionId;
    }
  }

  return null;
}

function deriveSessionIdCaptureCandidates(
  submittedSnapshot: string,
  snapshot: string,
  statusCommand: string,
) {
  const rawSubmitted = normalizePaneText(submittedSnapshot);
  const rawSnapshot = normalizePaneText(snapshot);
  return [
    extractScrolledAppend(rawSubmitted, rawSnapshot),
    deriveInteractionText(submittedSnapshot, snapshot),
    deriveInteractionDiffText(submittedSnapshot, snapshot),
    rawSnapshot,
    extractStatusCommandTail(rawSnapshot, statusCommand),
  ].filter((candidate, index, candidates) =>
    candidate && candidates.indexOf(candidate) === index
  );
}

function extractStatusCommandTail(snapshot: string, statusCommand: string) {
  const lastStatusIndex = snapshot.lastIndexOf(statusCommand);
  if (lastStatusIndex < 0) {
    return "";
  }
  return snapshot.slice(lastStatusIndex);
}

function extractSessionIdFromCaptureCandidates(candidates: string[], pattern: string) {
  for (const candidate of candidates) {
    const sessionId = parseRunnerSessionId(candidate, pattern);
    if (sessionId) {
      return sessionId;
    }
  }

  return null;
}

async function waitForTmuxPaneSettle(params: {
  tmux: TmuxClient;
  sessionName: string;
  captureLines: number;
  pollIntervalMs: number;
  quietWindowMs: number;
  maxWaitMs: number;
}) {
  let previousSnapshot = "";
  let previousState: TmuxPaneState | null = null;
  let lastChangeAt = Date.now();
  const deadline = Date.now() + params.maxWaitMs;

  while (true) {
    let snapshot = "";
    let state: TmuxPaneState;
    try {
      snapshot = normalizePaneText(
        await params.tmux.capturePane(params.sessionName, params.captureLines),
      );
      state = await params.tmux.getPaneState(params.sessionName);
    } catch (error) {
      if (isRetryableBootstrapTargetError(error)) {
        if (Date.now() >= deadline) {
          return;
        }
        await sleep(params.pollIntervalMs);
        continue;
      }
      if (isBootstrapSessionGoneError(error)) {
        throw buildBootstrapSessionLostError(params.sessionName, error);
      }
      throw error;
    }

    if (
      snapshot !== previousSnapshot ||
      !previousState ||
      !arePaneStatesEqual(previousState, state)
    ) {
      previousSnapshot = snapshot;
      previousState = state;
      lastChangeAt = Date.now();
    }

    if (Date.now() - lastChangeAt >= params.quietWindowMs || Date.now() >= deadline) {
      return;
    }

    await sleep(params.pollIntervalMs);
  }
}
