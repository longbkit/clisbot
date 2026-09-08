// Fusion-owned host adapter for `src/infra/outbound/internal-source-reply.ts` (D-CORE-040).
//
// Upstream routes a `send` back to the current run's internal UI sink when the
// caller is OpenClaw's own webchat/TUI rather than a chat platform. Fusion's
// channel reply capability always names a real external conversation, so the
// internal sink is never selected and `handleInternalSourceReplySendAction` in
// the runner stays unreachable.
export async function shouldUseInternalSourceReplySink(
  _input: unknown,
  _params: Record<string, unknown>,
): Promise<boolean> {
  return false;
}
