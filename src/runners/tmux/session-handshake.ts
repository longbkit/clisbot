import { extractSessionId } from "../../agents/session-identity.ts";
import { logLatencyDebug, type LatencyDebugContext } from "../../control/latency-debug.ts";
import { sleep } from "../../shared/process.ts";
import { normalizePaneText } from "../../shared/transcript.ts";
import type { TmuxClient, TmuxPaneState } from "./client.ts";

const TRUST_PROMPT_POLL_INTERVAL_MS = 250;
const TRUST_PROMPT_MAX_WAIT_MS = 10_000;
const TRUST_PROMPT_SETTLE_DELAY_MS = 1500;
const SESSION_BOOTSTRAP_POLL_INTERVAL_MS = 100;
const SUBMIT_CONFIRM_POLL_INTERVAL_MS = 40;
const SUBMIT_CONFIRM_MAX_WAIT_MS = 160;

export async function submitTmuxSessionInput(params: {
  tmux: TmuxClient;
  sessionName: string;
  text: string;
  promptSubmitDelayMs: number;
  timingContext?: LatencyDebugContext;
}) {
  await params.tmux.sendLiteral(params.sessionName, params.text);
  await sleep(params.promptSubmitDelayMs);
  const preSubmitState = await params.tmux.getPaneState(params.sessionName);

  await params.tmux.sendKey(params.sessionName, "Enter");
  if (
    await waitForPaneSubmitConfirmation({
      tmux: params.tmux,
      sessionName: params.sessionName,
      baseline: preSubmitState,
    })
  ) {
    return;
  }

  logLatencyDebug("tmux-submit-enter-retry", params.timingContext, {
    sessionName: params.sessionName,
  });
  await params.tmux.sendKey(params.sessionName, "Enter");
  if (
    await waitForPaneSubmitConfirmation({
      tmux: params.tmux,
      sessionName: params.sessionName,
      baseline: preSubmitState,
    })
  ) {
    return;
  }

  logLatencyDebug("tmux-submit-unconfirmed", params.timingContext, {
    sessionName: params.sessionName,
  });
  throw new Error(
    "tmux submit was not confirmed after Enter. The pane state did not change, so clisbot did not treat the prompt as truthfully submitted.",
  );
}

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
  let deadline = Date.now() + params.timeoutMs;

  await submitTmuxSessionInput({
    tmux: params.tmux,
    sessionName: params.sessionName,
    text: params.statusCommand,
    promptSubmitDelayMs: params.promptSubmitDelayMs,
    timingContext: undefined,
  });

  while (Date.now() < deadline) {
    await sleep(params.pollIntervalMs);
    const snapshot = normalizePaneText(
      await params.tmux.capturePane(params.sessionName, params.captureLines),
    );
    if (hasTrustPrompt(snapshot)) {
      await dismissTrustPrompt(params.tmux, params.sessionName);
      deadline = Date.now() + params.timeoutMs;
      await submitTmuxSessionInput({
        tmux: params.tmux,
        sessionName: params.sessionName,
        text: params.statusCommand,
        promptSubmitDelayMs: params.promptSubmitDelayMs,
        timingContext: undefined,
      });
      continue;
    }

    const sessionId = extractSessionId(snapshot, params.pattern);
    if (sessionId) {
      return sessionId;
    }
  }

  return null;
}

export async function dismissTmuxTrustPromptIfPresent(params: {
  tmux: TmuxClient;
  sessionName: string;
  captureLines: number;
  startupDelayMs: number;
}) {
  const deadline = Date.now() + Math.max(TRUST_PROMPT_MAX_WAIT_MS, params.startupDelayMs);

  while (Date.now() <= deadline) {
    const snapshot = normalizePaneText(
      await params.tmux.capturePane(params.sessionName, params.captureLines),
    );
    if (!snapshot) {
      await sleep(TRUST_PROMPT_POLL_INTERVAL_MS);
      continue;
    }

    if (!hasTrustPrompt(snapshot)) {
      return;
    }

    await dismissTrustPrompt(params.tmux, params.sessionName);
  }
}

export async function waitForTmuxSessionBootstrap(params: {
  tmux: TmuxClient;
  sessionName: string;
  captureLines: number;
  startupDelayMs: number;
}) {
  const deadline = Date.now() + Math.max(params.startupDelayMs, SESSION_BOOTSTRAP_POLL_INTERVAL_MS);

  while (Date.now() <= deadline) {
    let snapshot = "";
    try {
      snapshot = normalizePaneText(
        await params.tmux.capturePane(params.sessionName, params.captureLines),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("can't find session:") || message.includes("no server running on ")) {
        return "";
      }
      throw error;
    }
    if (snapshot) {
      return snapshot;
    }

    await sleep(SESSION_BOOTSTRAP_POLL_INTERVAL_MS);
  }

  return "";
}

function hasTrustPrompt(snapshot: string) {
  return (
    snapshot.includes("Do you trust the contents of this directory?") ||
    snapshot.includes("Press enter to continue")
  );
}

async function dismissTrustPrompt(tmux: TmuxClient, sessionName: string) {
  await tmux.sendKey(sessionName, "Enter");
  await sleep(TRUST_PROMPT_SETTLE_DELAY_MS);
}

async function waitForPaneSubmitConfirmation(params: {
  tmux: TmuxClient;
  sessionName: string;
  baseline: TmuxPaneState;
}) {
  const deadline = Date.now() + SUBMIT_CONFIRM_MAX_WAIT_MS;
  while (true) {
    const state = await params.tmux.getPaneState(params.sessionName);
    if (hasPaneStateChanged(params.baseline, state)) {
      return true;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return false;
    }
    await sleep(Math.min(SUBMIT_CONFIRM_POLL_INTERVAL_MS, remainingMs));
  }
}

function hasPaneStateChanged(left: TmuxPaneState, right: TmuxPaneState) {
  return (
    left.cursorX !== right.cursorX ||
    left.cursorY !== right.cursorY ||
    left.historySize !== right.historySize
  );
}
