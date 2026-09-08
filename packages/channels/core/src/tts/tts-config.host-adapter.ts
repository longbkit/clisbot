// Fusion-owned host adapter for `src/tts/tts-config.ts` (D-CORE-048).
//
// Upstream decides whether a reply should be spoken from OpenClaw's TTS config
// and the session's auto mode. Fusion ships no TTS engine, so automatic speech is
// off; a channel that wants voice sends an audio attachment explicitly.
export function shouldAttemptTtsPayload(_params: unknown): boolean {
  return false;
}
