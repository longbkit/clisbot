import { extractSessionId } from "../../agents/session-identity.ts";
import { logLatencyDebug, type LatencyDebugContext } from "../../control/latency-debug.ts";
import { sleep } from "../../shared/process.ts";
import {
  deriveInteractionText,
  extractScrolledAppend,
  normalizePaneText,
  splitNormalizedLines,
  trimBlankLines,
} from "../../shared/transcript.ts";
import type { TmuxClient, TmuxPaneState } from "./client.ts";

const TRUST_PROMPT_POLL_INTERVAL_MS = 250;
const TRUST_PROMPT_MAX_WAIT_MS = 10_000;
const SESSION_BOOTSTRAP_POLL_INTERVAL_MS = 100;
const PASTE_SETTLE_POLL_INTERVAL_MS = 40;
const PASTE_SETTLE_QUIET_WINDOW_MS = 60;
const PASTE_SETTLE_MULTILINE_MAX_WAIT_MS = 800;
const PASTE_SETTLE_SINGLE_LINE_MAX_WAIT_MS = 80;
const PASTE_CONFIRM_MAX_ATTEMPTS = 3;
const PASTE_CAPTURE_REVALIDATE_POLL_INTERVAL_MS = 40;
const PASTE_CAPTURE_REVALIDATE_MAX_WAIT_MS = 160;
const SUBMIT_CONFIRM_POLL_INTERVAL_MS = 40;
const SUBMIT_CONFIRM_MAX_WAIT_MS = 160;
const SUBMIT_SNAPSHOT_CONFIRM_POLL_INTERVAL_MS = 40;
const SUBMIT_SNAPSHOT_CONFIRM_MAX_WAIT_MS = 320;
const POST_STATUS_SETTLE_POLL_INTERVAL_MS = 40;
const POST_STATUS_SETTLE_QUIET_WINDOW_MS = 80;
const POST_STATUS_SETTLE_MAX_WAIT_MS = 240;
const TMUX_MISSING_TARGET_PATTERN = /(?:no current target|can't find pane|can't find window)/i;
const TMUX_MISSING_SESSION_PATTERN = /(?:can't find session:|no server running on )/i;
const TMUX_SERVER_UNAVAILABLE_PATTERN = /(?:No such file or directory|error connecting to|failed to connect to server)/i;

export class TmuxBootstrapSessionLostError extends Error {
  constructor(
    readonly sessionName: string,
    detail: string,
  ) {
    super(`tmux bootstrap lost session "${sessionName}": ${detail}`);
    this.name = "TmuxBootstrapSessionLostError";
  }
}

export class TmuxPasteUnconfirmedError extends Error {
  constructor(readonly attempts: number) {
    super(
      `tmux paste was not confirmed after ${attempts} delivery attempts. clisbot did not send Enter because the prompt was not truthfully visible in the pane.`,
    );
    this.name = "TmuxPasteUnconfirmedError";
  }
}

export class TmuxSubmitUnconfirmedError extends Error {
  constructor() {
    super(
      "tmux submit was not confirmed after Enter. The pane state did not change, so clisbot did not treat the prompt as truthfully submitted.",
    );
    this.name = "TmuxSubmitUnconfirmedError";
  }
}

export type TmuxSessionBootstrapResult =
  | {
      status: "ready";
      snapshot: string;
    }
  | {
      status: "blocked";
      snapshot: string;
      message: string;
    }
  | {
      status: "timeout";
      snapshot: string;
    };

export async function submitTmuxSessionInput(params: {
  tmux: TmuxClient;
  sessionName: string;
  text: string;
  promptSubmitDelayMs: number;
  timingContext?: LatencyDebugContext;
}) {
  const prePasteState = await params.tmux.getPaneState(params.sessionName);
  const captureLines = estimatePasteCaptureLines(params.text);
  const prePasteSnapshot = normalizePaneText(
    await params.tmux.capturePane(params.sessionName, captureLines),
  );
  const pasteDelivery = await deliverTmuxPasteWithConfirmation({
    tmux: params.tmux,
    sessionName: params.sessionName,
    text: params.text,
    baselineState: prePasteState,
    baselineSnapshot: prePasteSnapshot,
    captureLines,
    promptSubmitDelayMs: params.promptSubmitDelayMs,
    timingContext: params.timingContext,
  });
  if (!pasteDelivery.confirmed) {
    logLatencyDebug("tmux-paste-unconfirmed", params.timingContext, {
      sessionName: params.sessionName,
      attempts: pasteDelivery.attempts,
    });
    throw new TmuxPasteUnconfirmedError(pasteDelivery.attempts);
  }
  const preSubmitState = pasteDelivery.state;
  const preSubmitSnapshot = normalizePaneText(
    await params.tmux.capturePane(params.sessionName, captureLines),
  );

  await params.tmux.sendKey(params.sessionName, "Enter");
  const submitted = await waitForPaneSubmitConfirmation({
    tmux: params.tmux,
    sessionName: params.sessionName,
    baseline: preSubmitState,
    baselineSnapshot: preSubmitSnapshot,
    captureLines,
  });
  if (submitted.confirmed) {
    return { submittedSnapshot: preSubmitSnapshot };
  }

  logLatencyDebug("tmux-submit-enter-retry", params.timingContext, {
    sessionName: params.sessionName,
  });
  await params.tmux.sendKey(params.sessionName, "Enter");
  const retrySubmitted = await waitForPaneSubmitConfirmation({
    tmux: params.tmux,
    sessionName: params.sessionName,
    baseline: preSubmitState,
    baselineSnapshot: preSubmitSnapshot,
    captureLines,
  });
  if (retrySubmitted.confirmed) {
    return { submittedSnapshot: preSubmitSnapshot };
  }

  logLatencyDebug("tmux-submit-unconfirmed", params.timingContext, {
    sessionName: params.sessionName,
  });
  throw new TmuxSubmitUnconfirmedError();
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
    if (tmuxPaneHasTrustPrompt(snapshot)) {
      await dismissTrustPrompt({
        tmux: params.tmux,
        sessionName: params.sessionName,
        captureLines: params.captureLines,
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

    const sessionId = extractSessionId(
      deriveSessionIdentityText(statusSubmission.submittedSnapshot, snapshot),
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

function deriveSessionIdentityText(submittedSnapshot: string, snapshot: string) {
  const rawSubmitted = normalizePaneText(submittedSnapshot);
  const rawSnapshot = normalizePaneText(snapshot);
  return (
    extractScrolledAppend(rawSubmitted, rawSnapshot) ||
    deriveInteractionText(submittedSnapshot, snapshot)
  );
}

export async function dismissTmuxTrustPromptIfPresent(params: {
  tmux: TmuxClient;
  sessionName: string;
  captureLines: number;
  startupDelayMs: number;
}) {
  const deadline = Date.now() + Math.max(TRUST_PROMPT_MAX_WAIT_MS, params.startupDelayMs);

  while (Date.now() <= deadline) {
    let snapshot = "";
    try {
      snapshot = normalizePaneText(
        await params.tmux.capturePane(params.sessionName, params.captureLines),
      );
    } catch (error) {
      if (isRetryableBootstrapTargetError(error)) {
        await sleep(TRUST_PROMPT_POLL_INTERVAL_MS);
        continue;
      }
      if (isBootstrapSessionGoneError(error)) {
        throw buildBootstrapSessionLostError(params.sessionName, error);
      }
      throw error;
    }
    if (!snapshot) {
      await sleep(TRUST_PROMPT_POLL_INTERVAL_MS);
      continue;
    }

    if (!tmuxPaneHasTrustPrompt(snapshot)) {
      return;
    }

    await dismissTrustPrompt({
      tmux: params.tmux,
      sessionName: params.sessionName,
      captureLines: params.captureLines,
    });
  }
}

export async function waitForTmuxSessionBootstrap(params: {
  tmux: TmuxClient;
  sessionName: string;
  captureLines: number;
  startupDelayMs: number;
  trustWorkspace?: boolean;
  readyPattern?: string;
  blockers?: Array<{
    pattern: string;
    message: string;
  }>;
}): Promise<TmuxSessionBootstrapResult> {
  const deadline = Date.now() + Math.max(params.startupDelayMs, SESSION_BOOTSTRAP_POLL_INTERVAL_MS);
  const readyRegex = params.readyPattern ? new RegExp(params.readyPattern, "i") : null;
  const blockerPatterns = (params.blockers ?? []).map((entry) => ({
    regex: new RegExp(entry.pattern, "i"),
    message: entry.message,
  }));
  let lastSnapshot = "";

  while (Date.now() <= deadline) {
    let snapshot = "";
    try {
      snapshot = normalizePaneText(
        await params.tmux.capturePane(params.sessionName, params.captureLines),
      );
    } catch (error) {
      if (isRetryableBootstrapTargetError(error)) {
        await sleep(SESSION_BOOTSTRAP_POLL_INTERVAL_MS);
        continue;
      }
      if (isBootstrapSessionGoneError(error)) {
        throw buildBootstrapSessionLostError(params.sessionName, error);
      }
      throw error;
    }
    if (snapshot) {
      lastSnapshot = snapshot;
      if (params.trustWorkspace && tmuxPaneHasTrustPrompt(snapshot)) {
        await dismissTrustPrompt({
          tmux: params.tmux,
          sessionName: params.sessionName,
          captureLines: params.captureLines,
        });
        await sleep(SESSION_BOOTSTRAP_POLL_INTERVAL_MS);
        continue;
      }
      for (const blocker of blockerPatterns) {
        if (blocker.regex.test(snapshot)) {
          return {
            status: "blocked",
            snapshot,
            message: blocker.message,
          };
        }
      }
      if (readyRegex && !readyRegex.test(snapshot)) {
        await sleep(SESSION_BOOTSTRAP_POLL_INTERVAL_MS);
        continue;
      }
      return {
        status: "ready",
        snapshot,
      };
    }

    await sleep(SESSION_BOOTSTRAP_POLL_INTERVAL_MS);
  }

  return {
    status: "timeout",
    snapshot: lastSnapshot,
  };
}

async function dismissTrustPrompt(params: {
  tmux: TmuxClient;
  sessionName: string;
  captureLines: number;
}) {
  await params.tmux.sendKey(params.sessionName, "Enter");

  const deadline = Date.now() + TRUST_PROMPT_MAX_WAIT_MS;
  while (Date.now() <= deadline) {
    await sleep(TRUST_PROMPT_POLL_INTERVAL_MS);
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
    if (!snapshot || tmuxPaneHasTrustPrompt(snapshot)) {
      continue;
    }

    return;
  }
}

async function waitForPaneSubmitConfirmation(params: {
  tmux: TmuxClient;
  sessionName: string;
  baseline: TmuxPaneState;
  baselineSnapshot: string;
  captureLines: number;
}) {
  const deadline = Date.now() + SUBMIT_CONFIRM_MAX_WAIT_MS;
  while (true) {
    const state = await params.tmux.getPaneState(params.sessionName);
    if (hasPaneStateChanged(params.baseline, state)) {
      return {
        confirmed: true,
        snapshot: normalizePaneText(
          await params.tmux.capturePane(params.sessionName, params.captureLines),
        ),
      };
    }

    const snapshotChange = await waitForPaneSubmitSnapshotConfirmation({
      tmux: params.tmux,
      sessionName: params.sessionName,
      baselineSnapshot: params.baselineSnapshot,
      captureLines: params.captureLines,
      maxWaitMs: Math.min(
        SUBMIT_SNAPSHOT_CONFIRM_MAX_WAIT_MS,
        Math.max(0, deadline - Date.now()),
      ),
    });
    if (snapshotChange.confirmed) {
      return snapshotChange;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return {
        confirmed: false,
        snapshot: params.baselineSnapshot,
      };
    }
    await sleep(Math.min(SUBMIT_CONFIRM_POLL_INTERVAL_MS, remainingMs));
  }
}

async function waitForPaneSubmitSnapshotConfirmation(params: {
  tmux: TmuxClient;
  sessionName: string;
  baselineSnapshot: string;
  captureLines: number;
  maxWaitMs: number;
}) {
  const deadline = Date.now() + params.maxWaitMs;

  while (true) {
    const snapshot = normalizePaneText(
      await params.tmux.capturePane(params.sessionName, params.captureLines),
    );
    if (snapshot !== params.baselineSnapshot) {
      return {
        confirmed: true,
        snapshot,
      };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return {
        confirmed: false,
        snapshot: params.baselineSnapshot,
      };
    }
    await sleep(Math.min(SUBMIT_SNAPSHOT_CONFIRM_POLL_INTERVAL_MS, remainingMs));
  }
}

async function deliverTmuxPasteWithConfirmation(params: {
  tmux: TmuxClient;
  sessionName: string;
  text: string;
  baselineState: TmuxPaneState;
  baselineSnapshot: string;
  captureLines: number;
  promptSubmitDelayMs: number;
  timingContext?: LatencyDebugContext;
}) {
  for (let attempt = 1; attempt <= PASTE_CONFIRM_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      logLatencyDebug("tmux-paste-retry", params.timingContext, {
        sessionName: params.sessionName,
        attempt,
      });
    }
    await params.tmux.sendLiteral(params.sessionName, params.text);
    const pasteSettlement = await waitForPanePasteSettlement({
      tmux: params.tmux,
      sessionName: params.sessionName,
      baseline: params.baselineState,
      text: params.text,
      minDelayMs: params.promptSubmitDelayMs,
    });
    if (pasteSettlement.visible) {
      return {
        confirmed: true as const,
        state: pasteSettlement.state,
        attempts: attempt,
      };
    }

    const snapshotConfirmed = await waitForPanePasteSnapshotConfirmation({
      tmux: params.tmux,
      sessionName: params.sessionName,
      baselineSnapshot: params.baselineSnapshot,
      captureLines: params.captureLines,
    });
    if (snapshotConfirmed) {
      return {
        confirmed: true as const,
        state: await params.tmux.getPaneState(params.sessionName),
        attempts: attempt,
      };
    }
  }

  return {
    confirmed: false as const,
    state: params.baselineState,
    attempts: PASTE_CONFIRM_MAX_ATTEMPTS,
  };
}

async function waitForPanePasteSettlement(params: {
  tmux: TmuxClient;
  sessionName: string;
  baseline: TmuxPaneState;
  text: string;
  minDelayMs: number;
}) {
  await sleep(params.minDelayMs);

  let currentState = await params.tmux.getPaneState(params.sessionName);
  let sawChange = hasPaneStateChanged(params.baseline, currentState);
  let lastChangeAt = Date.now();
  const deadline =
    Date.now() +
    (shouldWaitForVisiblePaste(params.text)
      ? PASTE_SETTLE_MULTILINE_MAX_WAIT_MS
      : PASTE_SETTLE_SINGLE_LINE_MAX_WAIT_MS);

  while (true) {
    if (sawChange && Date.now() - lastChangeAt >= PASTE_SETTLE_QUIET_WINDOW_MS) {
      return {
        visible: true,
        state: currentState,
      };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return {
        visible: sawChange,
        state: currentState,
      };
    }

    await sleep(Math.min(PASTE_SETTLE_POLL_INTERVAL_MS, remainingMs));
    const nextState = await params.tmux.getPaneState(params.sessionName);
    if (!arePaneStatesEqual(currentState, nextState)) {
      currentState = nextState;
      if (hasPaneStateChanged(params.baseline, currentState)) {
        sawChange = true;
      }
      lastChangeAt = Date.now();
    }
  }
}

async function waitForPanePasteSnapshotConfirmation(params: {
  tmux: TmuxClient;
  sessionName: string;
  baselineSnapshot: string;
  captureLines: number;
}) {
  const deadline = Date.now() + PASTE_CAPTURE_REVALIDATE_MAX_WAIT_MS;

  while (true) {
    const snapshot = normalizePaneText(
      await params.tmux.capturePane(params.sessionName, params.captureLines),
    );
    if (snapshot !== params.baselineSnapshot) {
      return true;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return false;
    }
    await sleep(Math.min(PASTE_CAPTURE_REVALIDATE_POLL_INTERVAL_MS, remainingMs));
  }
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

function estimatePasteCaptureLines(text: string) {
  return Math.max(40, Math.min(160, text.split("\n").length + 24));
}

function hasPaneStateChanged(left: TmuxPaneState, right: TmuxPaneState) {
  return (
    left.cursorX !== right.cursorX ||
    left.cursorY !== right.cursorY ||
    left.historySize !== right.historySize
  );
}

function isRetryableBootstrapTargetError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return TMUX_MISSING_TARGET_PATTERN.test(message);
}

function isBootstrapSessionGoneError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    TMUX_MISSING_SESSION_PATTERN.test(message) ||
    TMUX_SERVER_UNAVAILABLE_PATTERN.test(message)
  );
}

function buildBootstrapSessionLostError(sessionName: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return new TmuxBootstrapSessionLostError(sessionName, message);
}

function arePaneStatesEqual(left: TmuxPaneState, right: TmuxPaneState) {
  return (
    left.cursorX === right.cursorX &&
    left.cursorY === right.cursorY &&
    left.historySize === right.historySize
  );
}

function looksLikeClaudeTrustPrompt(snapshot: string) {
  return (
    snapshot.includes("Quick safety check:") &&
    snapshot.includes("Yes, I trust this folder")
  ) || snapshot.includes("Enter to confirm · Esc to cancel");
}

function looksLikeGeminiTrustPrompt(snapshot: string) {
  return (
    snapshot.includes("Skipping project agents due to untrusted folder.") &&
    snapshot.includes("Do you trust the files in this folder?")
  ) || (
    snapshot.includes("Trusting a folder allows Gemini CLI to load its local configurations") &&
    snapshot.includes("Trust folder (default)")
  );
}

const TRUST_PROMPT_ACTIVE_TAIL_LINES = 24;
const TRUST_OPTION_LINE_PATTERN = /^[›❯]\s*\d+\.\s/i;
const INTERACTIVE_PROMPT_LINE_PATTERN = /^[›❯]\s*(?!\d+\.\s).+/;

function extractActiveTrustPromptRegion(snapshot: string) {
  const lines = trimBlankLines(splitNormalizedLines(snapshot));
  if (lines.length === 0) {
    return "";
  }

  return lines.slice(-TRUST_PROMPT_ACTIVE_TAIL_LINES).join("\n");
}

function findLastTrustPromptLineIndex(lines: string[]) {
  let lastIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (
      line.includes("Do you trust the contents of this directory?") ||
      line.includes("Press enter to continue") ||
      line.includes("Quick safety check:") ||
      line.includes("Enter to confirm · Esc to cancel") ||
      line.includes("Do you trust the files in this folder?") ||
      line.includes("Trust folder (default)")
    ) {
      lastIndex = index;
    }
  }

  return lastIndex;
}

function hasLaterInteractivePrompt(lines: string[], afterIndex: number) {
  for (const rawLine of lines.slice(afterIndex + 1)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (TRUST_OPTION_LINE_PATTERN.test(line)) {
      continue;
    }
    if (INTERACTIVE_PROMPT_LINE_PATTERN.test(line)) {
      return true;
    }
    if (
      /^gpt-[\w.-]+\b/i.test(line) ||
      line.includes("Type your message or @path/to/file") ||
      line.startsWith("Session:") ||
      line.startsWith("Model:")
    ) {
      return true;
    }
  }

  return false;
}

export function tmuxPaneHasTrustPrompt(snapshot: string) {
  const activeRegion = extractActiveTrustPromptRegion(snapshot);
  const activeLines = trimBlankLines(splitNormalizedLines(activeRegion));
  const lastTrustPromptLineIndex = findLastTrustPromptLineIndex(activeLines);
  if (lastTrustPromptLineIndex < 0) {
    return false;
  }

  if (hasLaterInteractivePrompt(activeLines, lastTrustPromptLineIndex)) {
    return false;
  }

  return (
    activeRegion.includes("Do you trust the contents of this directory?") ||
    activeRegion.includes("Press enter to continue") ||
    looksLikeClaudeTrustPrompt(activeRegion) ||
    looksLikeGeminiTrustPrompt(activeRegion)
  );
}

function shouldWaitForVisiblePaste(text: string) {
  return text.includes("\n");
}
