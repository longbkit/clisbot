// Fusion-owned host adapter for `src/tts/tts.runtime.ts` (D-CORE-048).
//
// The lazily loaded TTS provider runtime. Fusion ships none; `shouldAttemptTtsPayload`
// never returns true, so this module is unreachable and fails loudly if reached.
export async function maybeApplyTtsToPayload(_params: unknown): Promise<never> {
  throw new Error("Text-to-speech is not available in Fusion.");
}
