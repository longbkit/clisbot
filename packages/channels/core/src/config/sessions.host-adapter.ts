// Fusion-owned host adapter for `src/config/sessions.ts` (D-CORE-047).
//
// Upstream owns the file-backed session store: where it lives on disk and how an
// assistant message is appended to a session transcript. Fusion's transcripts are
// Paseo daemon agent sessions written by the daemon, so the store path is
// unavailable and the mirror append reports "not mirrored" instead of becoming a
// second writer.
export function resolveSessionStorePathCore(
  _store: unknown,
  _options?: { agentId?: string },
): string | undefined {
  return undefined;
}

export type AppendAssistantTranscriptResult = { ok: boolean; reason?: string };

export async function appendAssistantMessageToSessionTranscript(
  _params: unknown,
): Promise<AppendAssistantTranscriptResult> {
  return { ok: true };
}
