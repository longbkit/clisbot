# Conversation Follow-Up Policy And Runtime Control API

## Summary

Add session-scoped follow-up policy, configurable TTL, and a runtime control API so agents can change conversation behavior dynamically when the user asks.

## Status

Planned

## Why

Natural no-mention continuation is useful in Slack threads, but it can also become noisy.

The system needs two layers of control:

- static configuration for default behavior
- runtime session-scoped overrides that an agent can change on demand

This is especially important for the project goal of exposing Codex and Claude through channels while still letting the agent manage its own conversation behavior with tools or skills.

## Scope

- define session-scoped follow-up policy state
- support configurable follow-up participation TTL instead of a hardcoded lifetime
- support behavior modes such as:
  - continue after bot reply in thread
  - require mention every time
  - stop following until re-activated
- expose a runtime control API that can be called by channels, commands, or agent tools
- support agent-invoked policy changes when the user asks for quieter or stricter behavior
- document how static config defaults and runtime overrides interact

## Non-Goals

- implementing every transport-specific policy at once
- replacing channel mention-gating rules entirely
- operator-only recovery controls

## Subtasks

- [ ] define the canonical follow-up policy model for one conversation session
- [ ] define config defaults for Slack thread continuation and participation TTL
- [ ] define runtime override semantics and persistence boundaries
- [ ] define one runtime control API for reading and changing conversation follow-up policy
- [ ] expose that control API to agent tools or skills so Codex or Claude can change behavior during a conversation
- [ ] define channel command affordances for the same policy where useful
- [ ] add ground-truth tests for default follow-up behavior, runtime override behavior, and reset behavior

## Dependencies Or Blockers

- settled channel follow-up behavior target
- clear boundary between Agent-OS session state and channel delivery logic

## Related Docs

- [Agent-OS Feature](../../../features/agent-os/README.md)
- [Agent Commands](../../../features/agent-os/commands.md)
- [Channels Feature](../../../features/channels/README.md)
- [Configuration Feature](../../../features/configuration/README.md)
- [Slack Thread Follow-Up Behavior Research](../../../research/channels/2026-04-05-slack-thread-follow-up-behavior.md)

