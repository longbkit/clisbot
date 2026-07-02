// tmux backend error taxonomy: pane/server failure patterns, recoverability
// predicates, and truthful operator-facing error mapping. Startup and run
// flows classify through these helpers so recovery policy stays in one place.

import { renderCliCommand } from "../../control/commands/cli-name.ts";
import { readRunnerExitRecord } from "../../control/commands/clisbot-wrapper.ts";
import {
  paneShowsRunnerStateContention,
  paneShowsRunnerStateCorruption,
  RunnerStateContentionError,
  RunnerStateCorruptionError,
} from "../runner-state-failures.ts";

const TMUX_MISSING_SESSION_PATTERN = /(?:can't find session:|no server running on )/i;
const TMUX_SERVER_UNAVAILABLE_PATTERN = /(?:No such file or directory|error connecting to|failed to connect to server)/i;
const TMUX_DUPLICATE_SESSION_PATTERN = /duplicate session:/i;
const TMUX_TRANSIENT_TARGET_PATTERN =
  /(?:no current target|can't find pane|can't find window|no such pane|no such window|tmux pane state unavailable)/i;
// Narrower than the transient-target pattern above: bootstrap polling only
// retries on targets that may still be materializing, not on generic pane
// state failures.
const TMUX_MISSING_TARGET_PATTERN = /(?:no current target|can't find pane|can't find window)/i;

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

export type SessionErrorAction =
  | "during startup"
  | "before prompt submission"
  | "while the prompt was running";

export function summarizeSnapshot(snapshot: string) {
  const compact = snapshot
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 220);
  return compact ? ` Last visible pane: ${compact}` : "";
}

export function isTmuxDuplicateSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return TMUX_DUPLICATE_SESSION_PATTERN.test(message);
}

export function isMissingTmuxSessionError(error: unknown) {
  return error instanceof Error && TMUX_MISSING_SESSION_PATTERN.test(error.message);
}

export function isTmuxServerUnavailableError(error: unknown) {
  return error instanceof Error && TMUX_SERVER_UNAVAILABLE_PATTERN.test(error.message);
}

export function isTransientTmuxTargetError(error: unknown) {
  return error instanceof Error && TMUX_TRANSIENT_TARGET_PATTERN.test(error.message);
}

function isBootstrapSessionLostError(error: unknown) {
  return error instanceof TmuxBootstrapSessionLostError;
}

export function isRecoverableStartupSessionLoss(error: unknown) {
  return (
    isMissingTmuxSessionError(error) ||
    isTmuxServerUnavailableError(error) ||
    isBootstrapSessionLostError(error)
  );
}

export function isFreshStartRetryablePromptDeliveryError(error: unknown) {
  return error instanceof TmuxPasteUnconfirmedError || error instanceof TmuxSubmitUnconfirmedError;
}

export function isRetryableFreshStartFault(error: unknown) {
  return (
    isRecoverableStartupSessionLoss(error) ||
    isTransientTmuxTargetError(error) ||
    isFreshStartRetryablePromptDeliveryError(error)
  );
}

// Bootstrap-time polling classification: targets that may still be
// materializing are retryable; a gone session or server is a loss. These
// intentionally match on stringified messages because tmux client failures
// can surface as non-Error values.
export function isRetryableBootstrapTargetError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return TMUX_MISSING_TARGET_PATTERN.test(message);
}

export function isBootstrapSessionGoneError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    TMUX_MISSING_SESSION_PATTERN.test(message) ||
    TMUX_SERVER_UNAVAILABLE_PATTERN.test(message)
  );
}

export function buildBootstrapSessionLostError(
  sessionName: string,
  error: unknown,
  lastSnapshot = "",
) {
  const message = error instanceof Error ? error.message : String(error);
  return new TmuxBootstrapSessionLostError(sessionName, message, lastSnapshot);
}

// Maps a lingering post-exit pane to the truthful failure class. State-db
// contention is transient (retry with the preserved session id), state-db
// corruption is permanent (operator repair), anything else flows into the
// existing recoverable startup-loss handling with the pane as evidence.
export function classifyRunnerStartupExit(sessionName: string, snapshot: string) {
  if (paneShowsRunnerStateCorruption(snapshot)) {
    return new RunnerStateCorruptionError(sessionName, snapshot);
  }
  if (paneShowsRunnerStateContention(snapshot)) {
    return new RunnerStateContentionError(sessionName, snapshot);
  }
  return new TmuxBootstrapSessionLostError(
    sessionName,
    "runner exited during startup",
    snapshot,
  );
}

export async function mapTmuxSessionError(params: {
  stateDir: string;
  error: unknown;
  sessionName: string;
  action: SessionErrorAction;
  lastSnapshot?: string;
}) {
  const { error, sessionName, action } = params;
  const lastSnapshot = params.lastSnapshot ?? "";

  if (isRecoverableStartupSessionLoss(error)) {
    const exitRecord = await readRunnerExitRecord(params.stateDir, sessionName);
    const paneSnapshot =
      lastSnapshot ||
      (error instanceof TmuxBootstrapSessionLostError ? error.lastSnapshot : "");
    console.error("runner session disappeared", {
      sessionName,
      action,
      exitCode: exitRecord?.exitCode,
      exitedAt: exitRecord?.exitedAt,
      runnerCommand: exitRecord?.command,
      lastVisiblePane: paneSnapshot ? summarizeSnapshot(paneSnapshot).trim() : undefined,
    });
    const exitDetail =
      typeof exitRecord?.exitCode === "number"
        ? ` The runner process exited with code ${exitRecord.exitCode}.`
        : "";
    const nextStep =
      action === "while the prompt was running"
        ? `The prompt may have partially run; check ${renderCliCommand("watch --latest --lines 100", { inline: true })} before resending.`
        : "Your prompt was not submitted; resend it to retry.";
    return new Error(
      `Runner session "${sessionName}" disappeared ${action}.${exitDetail} ${nextStep} If this keeps happening, verify the runner CLI starts cleanly in the workspace terminal and inspect ${renderCliCommand("logs", { inline: true })}.${summarizeSnapshot(paneSnapshot)}`,
    );
  }

  if (isTransientTmuxTargetError(error)) {
    return new Error(
      `Runner session "${sessionName}" lost its tmux target ${action}. clisbot stayed alive, but this request could not continue cleanly. Retry once. If it keeps happening, inspect ${renderCliCommand("status", { inline: true })} and ${renderCliCommand("logs", { inline: true })}.${summarizeSnapshot(lastSnapshot)}`,
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}
