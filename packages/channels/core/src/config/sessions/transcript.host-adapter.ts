// Fusion-owned host adapter for `src/config/sessions/transcript.ts` (D-CORE-047).
//
// Only the mirror's transcript-entry shape is needed; the writer itself stays
// with the Paseo daemon. See `config/sessions.host-adapter.ts`.
export type SessionTranscriptEntry = {
  role: "assistant" | "user";
  content?: string;
  [key: string]: unknown;
};

/** The transcript sink an outbound mirror writes to. Upstream owns the writer. */
export type SessionTranscriptDeliveryMirror = {
  sessionKey: string;
  storePath?: string;
  agentId?: string;
  [key: string]: unknown;
};
