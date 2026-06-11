import { parseRunnerSessionId } from "../../agents/session/session-identity.ts";
import { logLatencyDebug, type LatencyDebugContext } from "../../control/runtime/latency-debug.ts";
import { sleep } from "../../infra/process.ts";
import {
  deriveInteractionDiffText,
  deriveInteractionText,
  extractScrolledAppend,
  normalizePaneText,
  splitNormalizedLines,
  trimBlankLines,
} from "../transcript/index.ts";
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
// Submit settling exits as soon as the composer truthfully drains, so a wider
// window only slows down the genuine-failure path. The previous 160ms/320ms
// windows produced false TmuxSubmitUnconfirmedError under host load or slow
// CLI redraws even though Enter had truthfully submitted.
const SUBMIT_CONFIRM_MAX_WAIT_MS = 600;
const SUBMIT_ENTER_MAX_ATTEMPTS = 3;
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
    readonly lastSnapshot = "",
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
      [
        "tmux submit was not confirmed after Enter: the pane did not change, so clisbot does not treat the prompt as truthfully submitted.",
        "The runner may be busy, redrawing slowly, or showing a blocking prompt.",
        "Check the live pane with `clisbot watch --latest --lines 100`; if your text is sitting unsubmitted there, send /nudge, otherwise resend the message.",
      ].join(" "),
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
      status: "resume-rejected";
      snapshot: string;
    }
  | {
      status: "exited";
      snapshot: string;
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
  trustPrompt?: {
    captureLines: number;
    startupDelayMs: number;
    trustWorkspace?: boolean;
  };
  timingContext?: LatencyDebugContext;
}) {
  if (params.trustPrompt) {
    await acceptTmuxStartupContinuePromptIfPresent({
      tmux: params.tmux,
      sessionName: params.sessionName,
      captureLines: params.trustPrompt.captureLines,
      startupDelayMs: params.trustPrompt.startupDelayMs,
      trustWorkspace: params.trustPrompt.trustWorkspace,
      waitForAppearance: false,
    });
  }
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

  for (let attempt = 1; attempt <= SUBMIT_ENTER_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      logLatencyDebug("tmux-submit-enter-retry", params.timingContext, {
        sessionName: params.sessionName,
        attempt,
      });
    }
    await params.tmux.sendKey(params.sessionName, "Enter");
    const outcome = await waitForSubmitSettled({
      tmux: params.tmux,
      sessionName: params.sessionName,
      baseline: preSubmitState,
      baselineSnapshot: preSubmitSnapshot,
      text: params.text,
      captureLines,
    });
    if (outcome === "submitted") {
      return { submittedSnapshot: preSubmitSnapshot };
    }
    // "pending-input": the pane changed but the prompt text is still sitting
    // in the CLI composer, meaning Enter landed as a newline or was swallowed
    // during a redraw. "unchanged": Enter had no visible effect at all. Both
    // are healed the way a manual /nudge would heal them: send Enter again.
  }

  logLatencyDebug("tmux-submit-unconfirmed", params.timingContext, {
    sessionName: params.sessionName,
  });
  throw new TmuxSubmitUnconfirmedError();
}

type SubmitSettleOutcome = "submitted" | "pending-input" | "unchanged";

// The submit gate is only allowed to report "submitted" when the pane both
// changed and no longer shows the prompt text waiting in the composer. A bare
// "pane changed" signal is not submission truth: Enter can land as a newline
// inside the composer, which changes the pane while the prompt stays unsent.
async function waitForSubmitSettled(params: {
  tmux: TmuxClient;
  sessionName: string;
  baseline: TmuxPaneState;
  baselineSnapshot: string;
  text: string;
  captureLines: number;
}): Promise<SubmitSettleOutcome> {
  const deadline = Date.now() + SUBMIT_CONFIRM_MAX_WAIT_MS;
  let sawChange = false;

  while (true) {
    let changed = sawChange;
    if (!changed) {
      const state = await params.tmux.getPaneState(params.sessionName);
      changed = hasPaneStateChanged(params.baseline, state);
    }
    const snapshot = normalizePaneText(
      await params.tmux.capturePane(params.sessionName, params.captureLines),
    );
    if (!changed) {
      changed = snapshot !== params.baselineSnapshot;
    }
    if (changed) {
      sawChange = true;
      if (!paneShowsPendingComposerText(snapshot, params.text)) {
        return "submitted";
      }
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return sawChange ? "pending-input" : "unchanged";
    }
    await sleep(Math.min(SUBMIT_CONFIRM_POLL_INTERVAL_MS, remainingMs));
  }
}

const COMPOSER_HINT_LINE_PATTERN =
  /^\?\s+for shortcuts|^Type your message or @path\/to\/file|^\d+%\s+context left|^press enter to send/i;
const COMPOSER_RUNNING_INDICATOR_PATTERN = /esc to interrupt/i;
const COMPOSER_BORDER_LINE_PATTERN = /^[─━═╌╍╭╮╰╯┌┐└┘+|\-_=\s]+$/;
const COMPOSER_TAIL_SCAN_LINES = 12;

// Conservative composer check: it only claims "pending" when the last
// contentful pane line is exactly the final prompt line, optionally behind a
// composer prompt character or inside a composer box border. False negatives
// fall back to the plain pane-change signal; false positives only cost one
// extra Enter, which is a no-op on an empty composer.
export function paneShowsPendingComposerText(snapshot: string, text: string) {
  const lastPromptLine = collapseWhitespace(lastNonEmptyLine(text));
  if (!lastPromptLine) {
    return false;
  }
  const lines = trimBlankLines(splitNormalizedLines(snapshot));
  for (
    let index = lines.length - 1;
    index >= Math.max(0, lines.length - COMPOSER_TAIL_SCAN_LINES);
    index -= 1
  ) {
    const line = (lines[index] ?? "").trim();
    if (!line || COMPOSER_HINT_LINE_PATTERN.test(line) || isPromptMetadataLine(line)) {
      continue;
    }
    if (COMPOSER_RUNNING_INDICATOR_PATTERN.test(line)) {
      // The runner is already executing; nothing is pending in the composer.
      return false;
    }
    if (COMPOSER_BORDER_LINE_PATTERN.test(line)) {
      // Composer box border; keep walking up to the composer content line.
      continue;
    }
    const stripped = stripComposerChrome(line);
    if (!stripped) {
      // A bare prompt character means the composer is empty: submitted.
      return false;
    }
    return stripped === lastPromptLine;
  }
  return false;
}

function stripComposerChrome(line: string) {
  return collapseWhitespace(
    line
      .replace(/^[│┃]\s*/, "")
      .replace(/\s*[│┃]$/, "")
      .replace(/^[›❯>]+\s*/, ""),
  );
}

function lastNonEmptyLine(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
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
  // This function only captures the runner-side sessionId from fresh status
  // output inside the tmux pane. It does not decide whether that id should be
  // persisted as storedSessionId; that boundary stays in the session-owned
  // continuity mapping above the tmux runner helpers.
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

export async function acceptTmuxStartupContinuePromptIfPresent(params: {
  tmux: TmuxClient;
  sessionName: string;
  captureLines: number;
  startupDelayMs: number;
  trustWorkspace?: boolean;
  waitForAppearance?: boolean;
}) {
  const waitForAppearance = params.waitForAppearance ?? true;
  const deadline = waitForAppearance
    ? Date.now() + Math.max(TRUST_PROMPT_MAX_WAIT_MS, params.startupDelayMs)
    : Date.now();

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
      if (!waitForAppearance) {
        return;
      }
      await sleep(TRUST_PROMPT_POLL_INTERVAL_MS);
      continue;
    }

    if (!tmuxPaneHasStartupContinuePrompt(snapshot, {
      trustWorkspace: params.trustWorkspace,
    })) {
      return;
    }

    await acceptStartupContinuePrompt({
      tmux: params.tmux,
      sessionName: params.sessionName,
      captureLines: params.captureLines,
      trustWorkspace: params.trustWorkspace,
    });
  }
}

export async function acceptTmuxTrustPromptIfPresent(params: {
  tmux: TmuxClient;
  sessionName: string;
  captureLines: number;
  startupDelayMs: number;
}) {
  await acceptTmuxStartupContinuePromptIfPresent({
    ...params,
    trustWorkspace: true,
    waitForAppearance: true,
  });
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
  resumeRejection?: {
    detect: (snapshot: string) => boolean;
  };
  exitDetection?: {
    detect: (snapshot: string) => boolean;
  };
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
        throw buildBootstrapSessionLostError(params.sessionName, error, lastSnapshot);
      }
      throw error;
    }
    if (snapshot) {
      lastSnapshot = snapshot;
      if (tmuxPaneHasStartupContinuePrompt(snapshot, {
        trustWorkspace: params.trustWorkspace,
      })) {
        await acceptStartupContinuePrompt({
          tmux: params.tmux,
          sessionName: params.sessionName,
          captureLines: params.captureLines,
          trustWorkspace: params.trustWorkspace,
        });
        await sleep(SESSION_BOOTSTRAP_POLL_INTERVAL_MS);
        continue;
      }
      if (params.resumeRejection?.detect(snapshot)) {
        return {
          status: "resume-rejected",
          snapshot,
        };
      }
      if (params.exitDetection?.detect(snapshot)) {
        return {
          status: "exited",
          snapshot,
        };
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
      if (readyRegex && !snapshotHasActiveReadyPattern(snapshot, readyRegex)) {
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

async function acceptStartupContinuePrompt(params: {
  tmux: TmuxClient;
  sessionName: string;
  captureLines: number;
  trustWorkspace?: boolean;
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
    if (
      !snapshot ||
      tmuxPaneHasStartupContinuePrompt(snapshot, {
        trustWorkspace: params.trustWorkspace,
      })
    ) {
      continue;
    }

    return;
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

function buildBootstrapSessionLostError(
  sessionName: string,
  error: unknown,
  lastSnapshot = "",
) {
  const message = error instanceof Error ? error.message : String(error);
  return new TmuxBootstrapSessionLostError(sessionName, message, lastSnapshot);
}

function arePaneStatesEqual(left: TmuxPaneState, right: TmuxPaneState) {
  return (
    left.cursorX === right.cursorX &&
    left.cursorY === right.cursorY &&
    left.historySize === right.historySize
  );
}

function snapshotHasActiveReadyPattern(snapshot: string, readyRegex: RegExp) {
  const lines = splitNormalizedLines(snapshot);
  let readyLineIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (readyRegex.test(lines[index] ?? "")) {
      readyLineIndex = index;
    }
  }

  if (readyLineIndex < 0) {
    return readyRegex.test(snapshot);
  }

  for (const rawLine of lines.slice(readyLineIndex + 1)) {
    const line = rawLine.trim();
    if (!line || isPromptMetadataLine(line)) {
      continue;
    }
    return false;
  }

  return true;
}

function isPromptMetadataLine(line: string) {
  return (
    /^gpt-[\w.-]+\b/i.test(line) ||
    /^model:\s*/i.test(line) ||
    /^session:\s*/i.test(line)
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

function looksLikeCodexUpdatePrompt(snapshot: string) {
  return (
    snapshot.includes("Update available!") &&
    snapshot.includes("@openai/codex") &&
    snapshot.includes("Release notes:") &&
    snapshot.includes("Press enter to continue")
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

function findLastStartupContinuePromptLineIndex(lines: string[]) {
  let lastIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (
      line.includes("Do you trust the contents of this directory?") ||
      line.includes("Quick safety check:") ||
      line.includes("Enter to confirm · Esc to cancel") ||
      line.includes("Do you trust the files in this folder?") ||
      line.includes("Trust folder (default)") ||
      line.includes("Update available!") ||
      line.includes("Skip until next version")
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
  const lastTrustPromptLineIndex = findLastStartupContinuePromptLineIndex(activeLines);
  if (lastTrustPromptLineIndex < 0) {
    return false;
  }

  if (hasLaterInteractivePrompt(activeLines, lastTrustPromptLineIndex)) {
    return false;
  }

  return (
    activeRegion.includes("Do you trust the contents of this directory?") ||
    looksLikeClaudeTrustPrompt(activeRegion) ||
    looksLikeGeminiTrustPrompt(activeRegion)
  );
}

export function tmuxPaneHasCodexUpdatePrompt(snapshot: string) {
  const activeRegion = extractActiveTrustPromptRegion(snapshot);
  const activeLines = trimBlankLines(splitNormalizedLines(activeRegion));
  const lastPromptLineIndex = findLastStartupContinuePromptLineIndex(activeLines);
  if (lastPromptLineIndex < 0) {
    return false;
  }

  if (hasLaterInteractivePrompt(activeLines, lastPromptLineIndex)) {
    return false;
  }

  return looksLikeCodexUpdatePrompt(activeRegion);
}

export function tmuxPaneHasStartupContinuePrompt(
  snapshot: string,
  options: { trustWorkspace?: boolean } = {},
) {
  if (tmuxPaneHasCodexUpdatePrompt(snapshot)) {
    return true;
  }

  return options.trustWorkspace !== false && tmuxPaneHasTrustPrompt(snapshot);
}

function shouldWaitForVisiblePaste(text: string) {
  return text.includes("\n");
}
