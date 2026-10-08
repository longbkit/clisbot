import path from "node:path";

import { describe, expect, test } from "vitest";

import { PersistedConfigSchema } from "../persisted-config.js";
import { resolveSpeechConfig } from "./speech-config-resolver.js";

describe("resolveSpeechConfig", () => {
  test("resolves local-first defaults without env overrides", () => {
    const clisbotHome = "/tmp/clisbot-home";
    const persisted = PersistedConfigSchema.parse({});
    const env = {} as NodeJS.ProcessEnv;

    const result = resolveSpeechConfig({
      clisbotHome,
      env,
      persisted,
    });

    expect(result.openai).toBeUndefined();
    expect(result.speech.providers.dictationStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.providers.voiceTurnDetection).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.providers.voiceStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.providers.voiceTts).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.local).toEqual({
      modelsDir: path.join(clisbotHome, "models", "local-speech"),
      models: {
        dictationStt: "parakeet-tdt-0.6b-v2-int8",
        voiceStt: "parakeet-tdt-0.6b-v2-int8",
        voiceTts: "kokoro-en-v0_19",
        voiceTtsSpeakerId: 0,
      },
    });
    expect(result.speech.local?.models.dictationStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceTts).toBe("kokoro-en-v0_19");
    expect(result.speech.local?.models.voiceTtsSpeakerId).toBe(0);
    expect(result.speech.sttLanguages).toEqual({
      dictation: "en",
      voice: "en",
    });
  });

  test("resolves feature-scoped local speech settings", () => {
    const persisted = PersistedConfigSchema.parse({
      features: {
        voiceMode: {
          turnDetection: { provider: "local" },
          stt: { provider: "openai", model: "gpt-4o-transcribe" },
        },
      },
      providers: {
        openai: { apiKey: "persisted-key" },
      },
    });
    const env = {
      CLISBOT_DICTATION_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
      CLISBOT_VOICE_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
      CLISBOT_VOICE_LOCAL_TTS_MODEL: "kokoro-en-v0_19",
      CLISBOT_VOICE_LOCAL_TTS_SPEAKER_ID: "5",
      CLISBOT_VOICE_LOCAL_TTS_SPEED: "1.35",
      CLISBOT_DICTATION_LANGUAGE: "es",
      CLISBOT_VOICE_LANGUAGE: "pt",
      CLISBOT_LOCAL_MODELS_DIR: "/tmp/models",
      OPENAI_API_KEY: "env-key",
      CLISBOT_VOICE_STT_PROVIDER: "openai",
      CLISBOT_DICTATION_STT_PROVIDER: "local",
      CLISBOT_VOICE_TTS_PROVIDER: "local",
    } as NodeJS.ProcessEnv;

    const result = resolveSpeechConfig({
      clisbotHome: "/tmp/clisbot-home",
      env,
      persisted,
    });

    expect(result.speech.local).toEqual({
      modelsDir: "/tmp/models",
      models: {
        dictationStt: "parakeet-tdt-0.6b-v2-int8",
        voiceStt: "parakeet-tdt-0.6b-v2-int8",
        voiceTts: "kokoro-en-v0_19",
        voiceTtsSpeakerId: 5,
        voiceTtsSpeed: 1.35,
      },
    });
    expect(result.speech.providers.dictationStt).toEqual({
      provider: "local",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.providers.voiceStt).toEqual({
      provider: "openai",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.providers.voiceTurnDetection).toEqual({
      provider: "local",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.providers.voiceTts).toEqual({
      provider: "local",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.local?.models.dictationStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceTts).toBe("kokoro-en-v0_19");
    expect(result.speech.local?.models.voiceTtsSpeakerId).toBe(5);
    expect(result.speech.local?.models.voiceTtsSpeed).toBe(1.35);
    expect(result.speech.sttLanguages).toEqual({
      dictation: "es",
      voice: "pt",
    });
    expect(result.openai?.stt?.apiKey).toBe("persisted-key");
    expect(result.openai?.tts?.apiKey).toBe("persisted-key");
    expect(result.openai?.stt?.model).toBe("gpt-4o-transcribe");
  });

  test("resolves STT language from env, settings, and voice-to-dictation fallback", () => {
    const persisted = PersistedConfigSchema.parse({
      features: {
        dictation: {
          stt: {
            language: "fr",
          },
        },
        voiceMode: {
          stt: {
            language: "de",
          },
        },
      },
    });

    const result = resolveSpeechConfig({
      clisbotHome: "/tmp/clisbot-home",
      env: {
        CLISBOT_DICTATION_LANGUAGE: "es",
        CLISBOT_VOICE_LANGUAGE: "  ",
      } as NodeJS.ProcessEnv,
      persisted,
    });

    expect(result.speech.sttLanguages).toEqual({
      dictation: "es",
      voice: "es",
    });
  });

  test("respects disabled dictation and voice mode feature flags", () => {
    const persisted = PersistedConfigSchema.parse({
      features: {
        dictation: { enabled: false },
        voiceMode: { enabled: false },
      },
    });

    const result = resolveSpeechConfig({
      clisbotHome: "/tmp/clisbot-home",
      env: {} as NodeJS.ProcessEnv,
      persisted,
    });

    expect(result.speech.providers.dictationStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
    expect(result.speech.providers.voiceTurnDetection).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
    expect(result.speech.providers.voiceStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
    expect(result.speech.providers.voiceTts).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
  });
});
