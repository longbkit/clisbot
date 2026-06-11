import { appendInteractionText } from "../../runners/transcript/index.ts";

export const MID_RUN_RECOVERY_MAX_ATTEMPTS = 2;
export const MID_RUN_RECOVERY_CONTINUE_PROMPT = "continue exactly where you left off";

export function mergeRunSnapshot(snapshotPrefix: string, snapshot: string) {
  return appendInteractionText(snapshotPrefix, snapshot);
}

export function buildRunRecoveryNote(
  kind:
    | "resume-attempt"
    | "resume-success"
    | "resume-failed"
    | "fresh-attempt"
    | "fresh-required"
    | "manual-new-required",
  params?: {
    attempt?: number;
    maxAttempts?: number;
    storedSessionId?: string;
  },
) {
  const storedIdDetail = params?.storedSessionId
    ? ` (stored session id ${params.storedSessionId})`
    : "";
  if (kind === "resume-attempt") {
    const attempt = params?.attempt ?? 1;
    const maxAttempts = params?.maxAttempts ?? MID_RUN_RECOVERY_MAX_ATTEMPTS;
    return `Runner session was lost. Attempting recovery ${attempt}/${maxAttempts} by reopening the same conversation context.`;
  }
  if (kind === "resume-success") {
    return "Recovery succeeded. Asking the runner to continue exactly where it left off.";
  }
  if (kind === "fresh-attempt") {
    return "The previous runner session could not be resumed. Opening a fresh runner session 2/2 without replaying your prompt.";
  }
  if (kind === "resume-failed") {
    return `The previous runner session could not be resumed${storedIdDetail}. The stored session id was preserved so the conversation can still be retried.`;
  }
  if (kind === "manual-new-required") {
    return [
      `The previous runner session could not be resumed, so the interrupted run stopped${storedIdDetail}.`,
      "clisbot preserved the stored session id instead of silently opening a new conversation, because the run was already in progress and its context may matter.",
      "Next steps: resend your prompt - clisbot will retry resuming this conversation and automatically fall back to a fresh one if the runner no longer has it.",
      "Send `/new` first if you prefer to start a clean conversation.",
    ].join(" ");
  }
  return "The previous runner session could not be resumed. clisbot opened a new fresh session, but did not replay your prompt because the prior conversation context is no longer guaranteed. Please resend the full prompt/context to continue.";
}

export function buildResumeRejectedFreshStartNote(params: {
  storedSessionId: string;
  reason: "rejected" | "exit";
  resumeCommand?: string;
}) {
  const cause =
    params.reason === "rejected"
      ? `the runner reported that saved session ${params.storedSessionId} no longer exists`
      : `the runner kept exiting while resuming saved session ${params.storedSessionId}`;
  const inspectHint = params.resumeCommand
    ? ` To inspect the old session manually, try \`${params.resumeCommand}\` in the workspace terminal.`
    : "";
  return [
    `The previous runner conversation could not be resumed: ${cause}.`,
    "clisbot opened a fresh conversation and is running your prompt there; earlier conversation context is not carried over.",
  ].join(" ") + inspectHint;
}
