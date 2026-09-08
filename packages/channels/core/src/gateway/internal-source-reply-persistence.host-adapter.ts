// Fusion-owned host adapter for `src/gateway/internal-source-reply-persistence.ts` (D-CORE-040).
//
// Persists an internal-UI source reply into the OpenClaw session transcript.
// Fusion never selects the internal sink (see
// `infra/outbound/internal-source-reply.host-adapter.ts`), so reaching this is a
// bug rather than a fallback.
export async function persistInternalSourceReply(_params: unknown): Promise<never> {
  throw new Error("Internal source-reply persistence is not available in Fusion.");
}
