# Audio Conversion And Transcription CLI

## Summary

Add a local `clisbot audio` CLI surface for two-way audio conversion:

- audio file to text
- text to audio file

This should start as an operator/local utility, then become the shared service
behind opt-in inbound audio attachment transcription.

## Status

Planned

## Priority

P1

## Why

Slack and Telegram can already deliver audio attachments into the agent
workspace, but today `clisbot` only passes those files through as
`@/absolute/path` mentions. A local audio layer would let the user transcribe
voice notes before the agent sees them and generate audio files that can be sent
back through existing `message send --file` paths.

The first slice should avoid changing chat runtime behavior until the local
conversion contract, macOS permissions, and provider fallback shape are proven.

## Scope

Phase 1:

- add `clisbot audio transcribe <file>`
- add `clisbot audio speak --text <text>` and `--body-file <path>`
- add output controls such as `--out`
- add `clisbot audio permissions status`
- add `clisbot audio permissions request --speech`
- implement a shared `src/audio` service boundary
- implement macOS Speech STT through a stable native Swift helper
- implement macOS system TTS through `say` or a Swift helper
- normalize or clearly reject unsupported audio formats before STT

Phase 2:

- add opt-in inbound audio attachment transcription
- preserve the original attachment
- write a sidecar transcript file such as `voice.txt`
- add transcript text to prompt shaping only when enabled
- add timeout, file-size, and duration limits

Phase 3:

- evaluate automatic spoken final replies separately after the CLI and inbound
  transcript contract are stable

## Non-Goals

- auto-transcribing all inbound audio by default
- replacing original attachments with transcript text
- automatic final-answer TTS in the first slice
- channel-specific voice-message send behavior in the first slice
- assuming macOS-only behavior works on Linux hosts

## Architecture Notes

- keep channel code responsible only for provider-specific file download
- keep attachment placement under the agents layer
- keep runners channel-agnostic
- keep the audio service independent of Slack and Telegram
- use `message send --file` for manual outbound audio delivery

## macOS Permission Notes

For file transcription, macOS primarily needs Speech Recognition permission, not
Microphone permission.

- file STT: `Speech Recognition`
- live mic, Talk mode, wake word: `Microphone` plus `Speech Recognition`
- system TTS: normally no separate privacy prompt

Do not have the background Node daemon call Apple Speech directly. macOS TCC
permission is tied to process identity, and `clisbot` may run through Terminal,
tmux, Bun, Node, npm wrappers, or a packaged binary. Use a stable Swift helper or
small app with `NSSpeechRecognitionUsageDescription`, then make permission
requests explicitly interactive.

Runtime behavior should be:

- check permission before transcription
- if missing, fail with a clear operator instruction
- never hang a chat request waiting for a system permission prompt

## Open Questions

- Should the public namespace be `clisbot audio` or `clisbot media audio`?
- Which normalized intermediate format should be the first supported STT input?
- Should `requiresOnDeviceRecognition=true` be supported in v1 or deferred?
- Should local Whisper be the default privacy fallback when macOS Speech cannot
  run on-device?

## Related Research

- [OpenClaw Voice TTS STT Architecture](../../../research/channels/2026-04-28-openclaw-voice-tts-stt-architecture.md)
- [Agent Workspace Attachments](../../../features/agents/attachments.md)
