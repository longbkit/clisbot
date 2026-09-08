// Fusion-owned host adapter for `src/config/sessions/transcript-write-context.ts` (D-CORE-047).
//
// Upstream fences concurrent transcript writers with an async-local claim
// (lifecycle revision + writer run id) so a stale run cannot append. Fusion does
// not write session transcripts from the channel plane, so there is no fence to
// own and the mirror writes nothing.
export type SessionTranscriptWriterFence = {
  expectedLifecycleRevision?: string;
  expectedWriterRunId?: string;
};

export function getOwnedSessionTranscriptWriterFence(_params: {
  sessionKey: string;
}): SessionTranscriptWriterFence | undefined {
  return undefined;
}
