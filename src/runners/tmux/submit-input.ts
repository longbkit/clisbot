// Truthful prompt delivery into a tmux pane: paste with visibility
// confirmation, Enter with drain confirmation, and conservative composer
// checks so clisbot never claims a prompt was submitted when it is still
// sitting unsent in the CLI composer.

import { logLatencyDebug, type LatencyDebugContext } from "../../control/runtime/latency-debug.ts";
import { sleep } from "../../infra/process.ts";
import {
  normalizePaneText,
  splitNormalizedLines,
  trimBlankLines,
} from "../transcript/index.ts";
import type { TmuxClient, TmuxPaneState } from "./client.ts";
import { TmuxPasteUnconfirmedError, TmuxSubmitUnconfirmedError } from "./errors.ts";
import { arePaneStatesEqual, hasPaneStateChanged } from "./pane-state.ts";
import {
  acceptTmuxStartupContinuePromptIfPresent,
  isPromptMetadataLine,
} from "./startup-prompts.ts";

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

function estimatePasteCaptureLines(text: string) {
  return Math.max(40, Math.min(160, text.split("\n").length + 24));
}

function shouldWaitForVisiblePaste(text: string) {
  return text.includes("\n");
}
