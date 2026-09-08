// Fusion-owned host adapter for `src/config/types.tts.ts` (D-CORE-048).
//
// Upstream's module types the whole TTS config tree (providers, voices, formats,
// per-channel overrides). The ported send path reads one value: the session-level
// auto mode. Fusion has no TTS engine yet, so only that literal union is carried.
export type TtsAutoMode = "off" | "on" | "reply";
