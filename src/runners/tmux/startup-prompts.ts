// Startup-prompt handling for the tmux backend: detect and accept trust,
// safety-check, and update-continue prompts that interactive CLIs show before
// they are ready, and wait for the session bootstrap to reach a truthful
// ready/blocked/exited state.

import { sleep } from "../../infra/process.ts";
import { normalizePaneText, splitNormalizedLines, trimBlankLines } from "../transcript/index.ts";
import type { TmuxClient } from "./client.ts";
import {
  buildBootstrapSessionLostError,
  isBootstrapSessionGoneError,
  isRetryableBootstrapTargetError,
} from "./errors.ts";

const TRUST_PROMPT_POLL_INTERVAL_MS = 250;
const TRUST_PROMPT_MAX_WAIT_MS = 10_000;
const SESSION_BOOTSTRAP_POLL_INTERVAL_MS = 100;

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

export async function acceptStartupContinuePrompt(params: {
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

export function isPromptMetadataLine(line: string) {
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
