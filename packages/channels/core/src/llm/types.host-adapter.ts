// Fusion-owned host adapter for `src/llm/types.ts` (D-CORE-060).
//
// Upstream's facade re-exports the whole `@openclaw/llm-core` type surface
// (providers, streams, usage, model refs). The ported send path reads one member:
// the speech facts a TTS-enabled delivery records on the payload.
export type AssistantDeliveryTtsFacts = {
  spokenText?: string;
  voice?: string;
  provider?: string;
  [key: string]: unknown;
};
