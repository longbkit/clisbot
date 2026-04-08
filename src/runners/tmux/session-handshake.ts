import { extractSessionId } from "../../agents/session-identity.ts";
import { sleep } from "../../shared/process.ts";
import { normalizePaneText } from "../../shared/transcript.ts";
import type { TmuxClient } from "./client.ts";

const TRUST_PROMPT_POLL_INTERVAL_MS = 250;
const TRUST_PROMPT_MAX_WAIT_MS = 10_000;
const TRUST_PROMPT_SETTLE_DELAY_MS = 1500;

export async function submitTmuxSessionInput(params: {
  tmux: TmuxClient;
  sessionName: string;
  text: string;
  promptSubmitDelayMs: number;
}) {
  await params.tmux.sendLiteral(params.sessionName, params.text);
  await sleep(params.promptSubmitDelayMs);
  await params.tmux.sendKey(params.sessionName, "Enter");
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
