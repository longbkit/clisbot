import { appendInteractionText } from "../shared/transcript.ts";

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
  },
) {
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
    return "The previous runner session could not be resumed. The stored session id was preserved; use `/new` to intentionally trigger a new runner conversation.";
  }
  if (kind === "manual-new-required") {
    return "The previous runner session could not be resumed. clisbot preserved the stored session id instead of opening a new conversation automatically. Use `/new` if you want to trigger a new runner conversation, then resend the prompt.";
  }
  return "The previous runner session could not be resumed. clisbot opened a new fresh session, but did not replay your prompt because the prior conversation context is no longer guaranteed. Please resend the full prompt/context to continue.";
}
