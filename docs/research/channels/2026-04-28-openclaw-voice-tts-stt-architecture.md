# OpenClaw Voice TTS STT Architecture

This note is a code-verified map of the current OpenClaw voice surface for
`clisbot` planning: supported text-to-speech (TTS), speech-to-text (STT), folder
organization, configuration, and the shortest implementation paths for adding
providers.

## Executive summary

OpenClaw has four different speech paths:

1. **Core outbound TTS** converts assistant replies into audio attachments. It is
   configured under `messages.tts` and implemented in `src/tts`.
2. **Inbound audio understanding / STT** transcribes audio attachments and voice
   notes before the agent sees them. It is configured under `tools.media.audio`
   and implemented in `src/media-understanding`.
3. **Talk mode** is a continuous native-app voice loop on macOS, iOS, and
   Android. STT is platform-native. TTS is ElevenLabs streaming with system voice
   fallback.
4. **Realtime voice surfaces** use the shared pieces:
   - Discord voice channels capture Opus, write WAV, transcribe through
     `tools.media.audio`, then speak with core TTS.
   - The `@openclaw/voice-call` plugin supports Twilio, Telnyx, Plivo, and mock
     telephony. Streaming STT is OpenAI Realtime; telephony TTS uses core OpenAI
     or ElevenLabs and converts to 8 kHz mu-law.

## Supported TTS

### Core reply TTS

Core TTS is used for outbound message replies, the `tts` tool, `/tts`, Gateway
RPC methods, Discord voice playback, and voice-call telephony TTS.

Code:

- `src/tts/tts.ts` - config resolution, provider order, auto modes, fallback,
  text length limits, temp file output, Telegram voice-note handling.
- `src/tts/tts-core.ts` - provider API calls, directive parsing, auto-summary.
- `src/config/types.tts.ts` - config types.
- `src/gateway/server-methods/tts.ts` - Gateway RPC methods.
- `src/agents/tools/tts-tool.ts` - agent `tts` tool.
- `src/auto-reply/reply/commands-tts.ts` - `/tts` command handling.

Supported core providers:

| Provider     | Default model / voice                             | Auth                                              | Notes                                                                                                                                                 |
| ------------ | ------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edge`       | `en-US-MichelleNeural`                            | none                                              | Uses `node-edge-tts`; enabled by default once TTS is on. Best-effort hosted Microsoft Edge TTS path.                                                  |
| `elevenlabs` | `eleven_multilingual_v2` / `pMsXgVXv3BLzUgSXRplE` | `ELEVENLABS_API_KEY`, `XI_API_KEY`, or config key | Supports `voiceSettings`, seed, language code, text normalization, base URL override.                                                                 |
| `openai`     | `gpt-4o-mini-tts` / `alloy`                       | `OPENAI_API_KEY` or `messages.tts.openai.apiKey`  | Also supports `tts-1` and `tts-1-hd`; custom OpenAI-compatible endpoint is available via `OPENAI_TTS_BASE_URL`, which relaxes model/voice validation. |

Core OpenAI voices listed in code:

`alloy`, `ash`, `ballad`, `cedar`, `coral`, `echo`, `fable`, `juniper`,
`marin`, `onyx`, `nova`, `sage`, `shimmer`, `verse`.

Provider selection:

- Explicit config or prefs provider wins.
- If no provider is configured, OpenClaw chooses `openai` when it has an API key,
  then `elevenlabs` when it has an API key, otherwise `edge`.
- Runtime fallback tries the selected provider first, then the other providers in
  `openai`, `elevenlabs`, `edge` order if configured.
- For Telegram, OpenAI/ElevenLabs output is Opus so it can be sent as a round
  voice-note bubble. Other channels default to MP3-style file output.
- Telephony TTS supports only OpenAI and ElevenLabs. Edge is explicitly skipped
  because telephony requires predictable PCM before mu-law conversion.

Config:

```json5
{
  messages: {
    tts: {
      auto: "always", // off | always | inbound | tagged
      mode: "final", // final | all
      provider: "openai",
      summaryModel: "openai/gpt-4.1-mini",
      maxTextLength: 4096,
      timeoutMs: 30000,
      openai: {
        model: "gpt-4o-mini-tts",
        voice: "alloy",
      },
      elevenlabs: {
        voiceId: "pMsXgVXv3BLzUgSXRplE",
        modelId: "eleven_multilingual_v2",
        voiceSettings: {
          stability: 0.5,
          similarityBoost: 0.75,
          style: 0.0,
          useSpeakerBoost: true,
          speed: 1.0,
        },
      },
      edge: {
        enabled: true,
        voice: "en-US-MichelleNeural",
        lang: "en-US",
        outputFormat: "audio-24khz-48kbitrate-mono-mp3",
      },
    },
  },
}
```

## Supported STT

### Inbound audio understanding

Inbound STT is the shared transcription path for audio attachments, Telegram
voice notes, Discord voice-channel captures, and any channel that passes audio
through media understanding.

Code:

- `src/media-understanding/runner.ts` - auto-detection and execution flow.
- `src/media-understanding/runner.entries.ts` - provider/CLI entry execution.
- `src/media-understanding/providers/*` - provider implementations.
- `src/media-understanding/apply.ts` - injects transcripts into message context.
- `src/media-understanding/audio-preflight.ts` - preflight transcription before
  Telegram group mention checks.
- `src/config/types.tools.ts` - `tools.media.audio` config shape.

Provider STT support:

| Provider            | Default audio model      | Endpoint style                                                                         |
| ------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `deepgram`          | `nova-3`                 | Deepgram `/listen`; supports query options such as language, smart format, punctuation |
| `google` / `gemini` | `gemini-3-flash-preview` | Gemini inline audio data generation API                                                |
| `groq`              | `whisper-large-v3-turbo` | OpenAI-compatible, default base URL `https://api.groq.com/openai/v1`                   |
| `mistral`           | `voxtral-mini-latest`    | OpenAI-compatible, default base URL `https://api.mistral.ai/v1`                        |
| `openai`            | `gpt-4o-mini-transcribe` | OpenAI `/audio/transcriptions`                                                         |

CLI STT support:

| CLI                   | Auto-detected when                                                                                        | Notes                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| custom CLI            | configured in `tools.media.audio.models`                                                                  | Args support templates such as `{{MediaPath}}`, `{{Prompt}}`, `{{OutputDir}}`, `{{MaxChars}}`. |
| `gemini`              | binary exists and probe succeeds                                                                          | Uses `read_many_files` to read media and return text.                                          |
| `sherpa-onnx-offline` | binary exists and `SHERPA_ONNX_MODEL_DIR` has `tokens.txt`, `encoder.onnx`, `decoder.onnx`, `joiner.onnx` | Fully local/offline path.                                                                      |
| `whisper`             | binary exists                                                                                             | Python Whisper CLI, default model `turbo`.                                                     |
| `whisper-cli`         | binary exists and model path exists                                                                       | Uses `WHISPER_CPP_MODEL` or `/opt/homebrew/share/whisper-cpp/for-tests-ggml-tiny.bin`.         |

Auto-detection order for audio:

1. Active model entry, if the current active provider supports audio and auth is
   available.
2. Local audio CLI: `sherpa-onnx-offline`, then `whisper-cli`, then `whisper`.
3. Gemini CLI.
4. Provider keys in order: `openai`, `groq`, `deepgram`, `google`, `mistral`.

Config:

```json5
{
  tools: {
    media: {
      concurrency: 2,
      audio: {
        enabled: true,
        maxBytes: 20971520,
        timeoutSeconds: 60,
        language: "vi",
        scope: {
          default: "allow",
          rules: [{ action: "deny", match: { chatType: "group" } }],
        },
        attachments: {
          mode: "first", // first | all
          maxAttachments: 1,
        },
        models: [
          { provider: "openai", model: "gpt-4o-mini-transcribe" },
          { provider: "deepgram", model: "nova-3", deepgram: { smartFormat: true } },
          {
            type: "cli",
            command: "whisper",
            args: ["--model", "base", "{{MediaPath}}"],
            timeoutSeconds: 45,
          },
        ],
      },
    },
  },
}
```

## Talk mode

Talk mode is implemented in native clients, not the Node gateway audio pipeline.

Folders:

- macOS: `apps/macos/Sources/OpenClaw/TalkModeRuntime.swift`,
  `TalkAudioPlayer.swift`, `TalkOverlay*.swift`.
- iOS: `apps/ios/Sources/Voice/TalkModeManager.swift`,
  `TalkOrbOverlay.swift`.
- Android: `apps/android/app/src/main/java/ai/openclaw/android/voice/TalkModeManager.kt`,
  `TalkDirectiveParser.kt`, `TalkOrbOverlay.kt`.
- Gateway config RPC: `src/gateway/server-methods/talk.ts`,
  `src/config/talk.ts`, `src/config/types.gateway.ts`.

Current support:

- STT:
  - macOS and iOS use Apple `SFSpeechRecognizer` with `AVAudioEngine`.
  - Android uses platform `SpeechRecognizer` with `RecognizerIntent`.
- TTS:
  - Primary provider implemented in clients is `elevenlabs`.
  - macOS/iOS stream ElevenLabs audio and play PCM or MP3 locally.
  - Android streams ElevenLabs, plays PCM through `AudioTrack` or MP3 through
    `MediaPlayer`.
  - macOS/iOS/Android have system voice fallback if ElevenLabs is missing or
    playback fails.
- Config is already normalized as `talk.provider` plus `talk.providers`, but
  non-ElevenLabs Talk providers are not implemented in clients yet.

Config:

```json5
{
  talk: {
    provider: "elevenlabs",
    providers: {
      elevenlabs: {
        voiceId: "elevenlabs_voice_id",
        modelId: "eleven_v3",
        outputFormat: "pcm_44100",
        apiKey: "elevenlabs_api_key",
        voiceAliases: {
          Default: "elevenlabs_voice_id",
        },
      },
    },
    interruptOnSpeech: true,
  },
}
```

## Discord voice channels

Discord voice channels are a server-side realtime conversation path.

Code:

- `src/discord/voice/manager.ts`
- `src/discord/voice/command.ts`
- `src/config/types.discord.ts`

Flow:

1. `/vc join` or `channels.discord.voice.autoJoin` joins a Discord voice/stage
   channel with `@discordjs/voice`.
2. Receive stream is Opus. OpenClaw decodes with `@discordjs/opus`, falling back
   to `opusscript`.
3. PCM is written as a temp WAV file.
4. WAV is transcribed through the shared `tools.media.audio` path.
5. The transcript is sent to the agent with `deliver: false`.
6. Reply text is spoken with core `textToSpeech`, using
   `channels.discord.voice.tts` as a deep override over `messages.tts`.

Config:

```json5
{
  channels: {
    discord: {
      voice: {
        enabled: true,
        autoJoin: [{ guildId: "123", channelId: "456" }],
        daveEncryption: true,
        decryptionFailureTolerance: 24,
        tts: {
          provider: "openai",
          openai: { voice: "alloy" },
        },
      },
    },
  },
}
```

## Voice Call plugin

The official `@openclaw/voice-call` plugin runs inside the Gateway process.

Folders:

- `extensions/voice-call/src/config.ts` - config schema and env resolution.
- `extensions/voice-call/src/providers/*` - Twilio, Telnyx, Plivo, mock, OpenAI
  Realtime STT, OpenAI TTS helper.
- `extensions/voice-call/src/media-stream.ts` - Twilio media stream WebSocket
  handler.
- `extensions/voice-call/src/telephony-tts.ts` - bridge to core telephony TTS
  and mu-law conversion.
- `extensions/voice-call/src/manager/*` - call state, outbound, events, timers,
  persistence.

Supported telephony providers:

- `twilio`
- `telnyx`
- `plivo`
- `mock`

Speech support:

- Streaming STT: `openai-realtime` only, default model `gpt-4o-transcribe`,
  using OpenAI Realtime transcription WebSocket with server VAD.
- Non-streaming call providers can also use provider-native speech capture paths
  such as Twilio Gather / Plivo GetInput where implemented by provider handlers.
- Telephony TTS: core OpenAI or ElevenLabs via `textToSpeechTelephony`, then
  converted to 8 kHz mu-law for media streams.
- Edge TTS is ignored for telephony.

Config:

```json5
{
  plugins: {
    entries: {
      "voice-call": {
        enabled: true,
        config: {
          provider: "twilio",
          fromNumber: "+15550001234",
          toNumber: "+15550005678",
          twilio: {
            accountSid: "ACxxxxxxxx",
            authToken: "...",
          },
          serve: {
            port: 3334,
            path: "/voice/webhook",
          },
          tunnel: { provider: "ngrok" },
          streaming: {
            enabled: true,
            sttProvider: "openai-realtime",
            sttModel: "gpt-4o-transcribe",
            silenceDurationMs: 800,
            vadThreshold: 0.5,
            streamPath: "/voice/stream",
          },
          stt: {
            provider: "openai",
            model: "whisper-1",
          },
          tts: {
            provider: "elevenlabs",
            elevenlabs: {
              voiceId: "pMsXgVXv3BLzUgSXRplE",
              modelId: "eleven_multilingual_v2",
            },
          },
        },
      },
    },
  },
}
```

## Folder organization map

High-level repo structure:

| Path                                                                                | Purpose                                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/cli`, `src/commands`                                                           | CLI wiring and command implementations.                               |
| `src/config`                                                                        | Config types, schemas, migration, help text, redaction.               |
| `src/gateway`                                                                       | Gateway WebSocket/HTTP server, RPC methods, node events.              |
| `src/agents`                                                                        | Agent runners, tools, system prompt, model auth/selection.            |
| `src/media`, `src/media-understanding`                                              | Attachment storage/parsing and image/audio/video understanding.       |
| `src/tts`                                                                           | Core text-to-speech.                                                  |
| `src/telegram`, `src/slack`, `src/discord`, `src/signal`, `src/imessage`, `src/web` | Built-in channel implementations.                                     |
| `extensions/*`                                                                      | Plugin packages. Channel plugins and voice-call live here.            |
| `apps/macos`, `apps/ios`, `apps/android`                                            | Native node apps and Talk/Voice Wake clients.                         |
| `docs`                                                                              | Mintlify docs. English docs are canonical; `docs/zh-CN` is generated. |
| `skills`                                                                            | Built-in OpenClaw skills.                                             |
| `test` plus colocated `*.test.ts`                                                   | Test fixtures and colocated unit/integration tests.                   |

Voice-specific code map:

| Feature              | Main files                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Core TTS             | `src/tts/*`, `src/config/types.tts.ts`, `src/gateway/server-methods/tts.ts`, `src/agents/tools/tts-tool.ts` |
| Inbound STT          | `src/media-understanding/*`, `src/config/types.tools.ts`, `src/media/*`                                     |
| Telegram voice notes | `src/telegram/bot-message-context.ts`, `src/telegram/voice.ts`, `src/telegram/send.ts`                      |
| Discord voice        | `src/discord/voice/*`, `src/config/types.discord.ts`                                                        |
| Talk mode            | native app `TalkMode*` files plus `src/gateway/server-methods/talk.ts`                                      |
| Voice wake           | `src/infra/voicewake.ts`, `src/gateway/server-methods/voicewake.ts`, native `VoiceWake*` files              |
| Voice Call plugin    | `extensions/voice-call/src/*`, `docs/plugins/voice-call.md`                                                 |

## clisbot implementation implications

The safest `clisbot` path is to split audio work into explicit phases instead of
folding it into the chat runtime immediately.

### Phase 1: standalone conversion CLI

Add a local utility surface first:

```bash
clisbot audio transcribe input.oga --language vi-VN --out transcript.txt
clisbot audio speak --text "xin chào" --out reply.aiff
clisbot audio speak --body-file reply.txt --out reply.m4a
clisbot audio permissions status
clisbot audio permissions request --speech
```

This should live as a control/local utility, not a channel behavior. It can be
implemented with a shared `src/audio` service and a `src/control/audio-cli.ts`
entry, then later reused by attachment and message flows.

Provider shape:

- `macos-speech` for STT using a Swift helper around
  `SFSpeechURLRecognitionRequest(fileURL:)`.
- `macos-system` for TTS using either `say` initially or a Swift helper around
  `AVSpeechSynthesizer`.
- future fallback providers such as Whisper CLI, OpenAI, or Deepgram should use
  the same service interface instead of special channel code.

Audio normalization is required before relying on Apple Speech. Telegram voice
notes are commonly OGG/Opus, while Apple Speech file recognition should not be
assumed to accept every channel-native format directly. The CLI should normalize
or reject with a clear error before invoking the provider.

### Phase 2: inbound audio attachment transcription

Current `clisbot` attachment behavior is intentionally small:

- channels detect and download Slack or Telegram files
- the agents layer stores them under
  `{workspace}/.attachments/{sessionKey}/{messageId}/...`
- prompt shaping prepends `@/absolute/path` mentions
- runners stay channel-agnostic

Auto-transcribing attachments would change the current prompt contract, so it
should be opt-in. A conservative shape is:

```json
{
  "agents": {
    "defaults": {
      "audio": {
        "transcribeAttachments": true,
        "provider": "macos-speech",
        "language": "vi-VN"
      }
    }
  }
}
```

When enabled, keep the original audio file and add a sidecar transcript file
such as `voice.txt`. The prompt can then include the transcript while preserving
the source attachment path for agents that want to inspect or retry.

### Phase 3: outbound spoken replies

Text-to-audio as a standalone utility is low risk because `clisbot message send
--file` already sends local files. Automatic final-answer TTS is higher risk
because it touches response rendering, streaming/progress behavior,
message-tool/final reply contracts, channel-specific voice/audio/document send
semantics, and route/bot/agent policy. That belongs after the CLI and inbound
transcription contracts are stable.

### macOS permission model

For file transcription on macOS, the main privacy gate is Speech Recognition,
not Microphone:

- audio file STT needs `Speech Recognition` permission for the process calling
  Apple Speech
- live mic, Talk mode, and wake-word listening need both `Microphone` and
  `Speech Recognition`
- system TTS through `say` or `AVSpeechSynthesizer` normally does not need a
  separate privacy prompt

The hard part is not the API call; it is macOS TCC identity. `clisbot` often
runs as a CLI/background daemon through Terminal, tmux, Bun, Node, or an npm
wrapper. If the Node daemon calls Apple Speech directly, the permission prompt
may not appear reliably, and permission may attach to the wrong identity.
Updates can also change the effective executable identity and make permission
failures look unrelated.

Use a stable native helper instead:

- ship a Swift helper or small app with `Info.plist` usage text such as
  `NSSpeechRecognitionUsageDescription`
- expose `clisbot audio permissions status/request`
- require permission requests to run interactively
- let the background runtime call transcription only after permission is already
  authorized
- if permission is missing, return an actionable error rather than blocking the
  chat request

If the product needs stronger privacy, expose
`requiresOnDeviceRecognition=true`, but treat it as a strict mode that can fail
for unsupported locales or missing local models. A local Whisper fallback may be
more predictable than Apple cloud recognition for privacy-sensitive hosts.

### Expected blast radius

Standalone CLI conversion has low blast radius. It adds a control utility and a
service module without changing channel ingress, runner prompts, or message
delivery.

Inbound auto-transcription has medium blast radius because it changes attachment
prompt shaping and request latency. It needs timeouts, max file limits, opt-in
config, and regression coverage around Slack/Telegram audio uploads.

Automatic spoken replies have higher blast radius because they touch outbound
response policy and final delivery. Keep that separate from the first
implementation slice.

## Implementation paths

### Add a core TTS provider

1. Add provider id to `src/config/types.tts.ts` and related Zod/plugin-sdk
   schemas.
2. Extend `ResolvedTtsConfig` and `resolveTtsConfig` in `src/tts/tts.ts`.
3. Implement provider API call in `src/tts/tts-core.ts` or a new sibling file.
4. Add provider to `TTS_PROVIDERS`, `resolveTtsApiKey`,
   `isTtsProviderConfigured`, `textToSpeech`, and optionally
   `textToSpeechTelephony`.
5. Update `src/gateway/server-methods/tts.ts`, `/tts` command help, docs, and
   tests.
6. Decide output formats per channel. Telegram needs voice-compatible Opus if it
   should send as a voice bubble.

### Add an STT provider for audio attachments

1. Add `src/media-understanding/providers/<id>/index.ts` and implement
   `transcribeAudio`.
2. Register it in `src/media-understanding/providers/index.ts`.
3. Add a default model in `src/media-understanding/defaults.ts` if it should
   auto-detect from API keys.
4. Add provider auth/env mapping in model auth if it does not already exist.
5. Add config docs under [Audio](/nodes/audio) and provider docs if needed.
6. Add tests for request shape, default model, base URL/header overrides,
   language/prompt handling, and fallback behavior.

### Add a custom local STT command

No code change is required. Configure a CLI model:

```json5
{
  tools: {
    media: {
      audio: {
        enabled: true,
        models: [
          {
            type: "cli",
            command: "/usr/local/bin/my-transcriber",
            args: ["--lang", "vi", "--file", "{{MediaPath}}"],
            timeoutSeconds: 60,
          },
        ],
      },
    },
  },
}
```

The CLI should exit 0 and print the transcript to stdout, or write a supported
Whisper output file when using `whisper` / `whisper-cli` conventions.

### Add a Talk mode provider

This is larger than core TTS because each native client streams and plays audio
directly.

1. Keep `talk.provider` / `talk.providers.<id>` in Gateway config shape.
2. Add provider selection and config parsing in macOS, iOS, and Android.
3. Implement streaming request and local playback format support per platform.
4. Add system voice fallback behavior and directive parsing compatibility.
5. Update `docs/nodes/talk.md`, native app tests, and Gateway config tests.

### Add a voice-call STT provider

For non-realtime call turns, prefer reusing `tools.media.audio` if the provider
can supply a WAV/file. For streaming telephony:

1. Add a provider in `extensions/voice-call/src/providers`.
2. Extend `VoiceCallStreamingConfigSchema` with the provider id and settings.
3. Wire it into `extensions/voice-call/src/media-stream.ts`.
4. Preserve stream authentication, pre-start throttles, VAD/end-of-speech
   behavior, and barge-in callbacks.
5. Add closed-loop tests under `extensions/voice-call/src`.

## Practical defaults

Recommended low-friction setup:

- Inbound STT: `tools.media.audio.enabled=true` and let auto-detection choose a
  local CLI first, then provider keys.
- Reliable cloud STT: explicit ordered models with OpenAI first and Deepgram or
  Mistral as fallback.
- Outbound TTS: `messages.tts.provider="openai"` for simple setup, or
  ElevenLabs for voice quality and Talk mode consistency.
- Talk mode: configure `talk.providers.elevenlabs` explicitly and keep
  `interruptOnSpeech=true`.
- Discord voice: configure `tools.media.audio` first; Discord voice depends on
  that pipeline for STT.
- Voice Call: use streaming only when `OPENAI_API_KEY` is available and webhook
  exposure/signature verification are stable.
