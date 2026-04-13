# Thread-Scoped Active Run Isolation

## Summary

Investigate and fix cases where a prompt sent from one chat thread is rejected with `This session already has an active run` even though the live run belongs to a different thread.

## Status

Planned

## Why

`clisbot` is supposed to let separate routed threads or topics behave like separate conversations unless they intentionally map onto the same logical session.

If a live run in thread A can unexpectedly block thread B, the product becomes confusing and unsafe to use in shared channels because the operator cannot tell whether the rejection is correct, stale, or leaked from another route.

## Scope

- reproduce the reported cross-thread rejection on the current Slack and Telegram routing model
- verify whether the wrong behavior comes from session-key derivation, active-run persistence, follow-up routing, or stale observer state
- confirm the intended isolation rules for:
  - different Slack threads in the same channel
  - different Telegram topics in the same group
  - independent routed conversations that share one agent but should not share one live run
- fix the wrong rejection path without breaking legitimate same-session active-run protection
- add regression tests for the failing scenario

## Current Truth

- `clisbot` intentionally rejects a second prompt when the same logical session already has a live active run
- users now have `/attach`, `/watch`, and `/stop` commands for legitimate same-session concurrency conflicts
- there is now at least one real user report that a different thread surfaced that rejection unexpectedly, which means either isolation or stale-state behavior is still wrong somewhere

## Non-Goals

- removing active-run protection entirely
- allowing concurrent prompts into one intentionally shared logical session
- redesigning the whole observer model in this slice

## Subtasks

- [ ] capture a concrete reproduction case from real thread or topic routing
- [ ] trace session-key derivation and active-run lookup for the failing route
- [ ] verify whether stale persisted active-run state can survive after the real owner thread is no longer attached
- [ ] fix the incorrect rejection path while preserving correct same-session blocking
- [ ] add regression tests for cross-thread isolation
- [ ] document the final rule in the user guide if the intended behavior needed clarification

## Exit Criteria

- a live run in one routed thread does not incorrectly block a new prompt in an unrelated routed thread
- the same logical session still rejects concurrent prompts with the existing `/attach`, `/watch`, or `/stop` guidance
- regression tests cover the reported failure shape

## Dependencies Or Blockers

- truthful definition of session identity across Slack threads, Telegram topics, and follow-up routing

## Related Docs

- [Channels Feature](../../../features/channels/README.md)
- [Telegram Topics Channel MVP](2026-04-05-telegram-topics-channel-mvp.md)
- [Conversation Follow-Up Policy And Runtime Control API](../agents/2026-04-05-conversation-follow-up-policy-and-runtime-control-api.md)
- [Observer-Based Session Attach, Detach, And Watch](../../2026-04-08-observer-based-session-attach-detach-and-watch.md)
