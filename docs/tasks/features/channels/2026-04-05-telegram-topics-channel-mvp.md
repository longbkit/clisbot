# Telegram Topics Channel MVP

## Summary

Add Telegram as the next real channel, with forum topic support modeled after OpenClaw and matched against the current Slack feature contract where that contract still makes sense.

## Status

Ready

## Why

Telegram topics are the closest Telegram equivalent to Slack threads, but they are not the same mechanism.

`clisbot` should support Telegram in a way that:

- stays compatible with OpenClaw’s Telegram config and routing model
- reuses the current `clisbot` chat-first rendering contract
- does not incorrectly copy Slack follow-up cache behavior into Telegram topics

## Scope

- Telegram Bot API channel
- long-polling first
- one configured Telegram bot account first
- DM, group, and forum-topic routing
- topic-aware session keys
- topic-aware reply placement and typing indicators
- OpenClaw-like `groups.<chatId>.topics.<threadId>` config inheritance
- Telegram support for current control commands where sensible
- parity planning for streaming and final settlement
- Telegram rate-limit-safe live reply editing
- Telegram update ingestion that stays concurrent across unrelated chats and topics

## Non-Goals

- Telegram webhook mode in the first slice
- multi-account Telegram support in the first slice
- Telegram-specific draft streaming in the first slice
- copying Slack follow-up participation TTL into topic identity

## Research

- [OpenClaw Telegram Topics And Slack-Parity Plan](../../../research/channels/2026-04-05-openclaw-telegram-topics-and-parity-plan.md)

## Subtasks

- [ ] define `channels.telegram` config shape with OpenClaw-compatible naming where practical
- [ ] define Telegram conversation kinds: `dm`, `group`, `topic`
- [ ] define session-key rules for Telegram groups and forum topics
- [ ] define General topic special-case send behavior
- [ ] define topic inheritance from parent group config
- [ ] define Telegram route matching against `groups.<chatId>.topics.<threadId>`
- [x] support topic-aware reply placement and typing indicators
- [ ] support Telegram-native slash commands for current control commands
- [ ] map `/followup` to Telegram semantics carefully instead of copying Slack behavior blindly
- [ ] support the current chat-first `streaming` and `response` contract on Telegram
- [x] honor Telegram `retry after` limits and pace live reply edits to avoid 429 edit failures during streaming
- [x] dispatch Telegram updates without whole-bot polling serialization so one busy conversation does not block other chats or topics
- [x] define Telegram processing feedback policy: typing first, live reply second
- [ ] add Telegram test cases for DM, group, topic, and General topic routing

## Exit Criteria

- a Telegram DM can reach an agent and receive a reply
- a Telegram forum topic gets its own isolated `sessionKey`
- repeated messages in the same topic continue the same conversation
- a different topic in the same group does not leak context from the first topic
- replies and typing indicators stay inside the correct topic
- General topic handling is correct
- Telegram control commands work in DMs and topics
- Telegram rendering honors the same `streaming` and `response` contract already used by Slack
- one busy Telegram topic or DM does not block another unrelated Telegram conversation on the same bot token

## Dependencies

- current Slack channel contract remains the reference user experience
- Agent-OS session identity stays stable
- runner output normalization remains channel-agnostic

## Related Docs

- [Channels Feature](../../../features/channels/README.md)
- [Configuration Feature](../../../features/configuration/README.md)
- [Channel Tests](../../../tests/features/channels/README.md)
