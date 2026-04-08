# Slack Channel MVP Validation And Hardening

## Summary

Finish the first real channel: Slack Socket Mode to a long-lived coding agent on `SLACK_TEST_CHANNEL`, with truthful recovery and follow-up behavior.

## Status

In Progress

## Why

The product goal depends on proving that a channel event can reach a persistent agent session, stream updates back, recover cleanly after tmux loss, and continue naturally inside the same thread when Slack delivers the needed events.

## Scope

- validate the real `SLACK_TEST_CHANNEL` mention path end to end
- ensure thread replies can continue the conversation
- prove killed-session recovery in the same Slack thread
- prove stored runner session-id resume during tmux session recreation
- harden mention gating, thread routing, dedupe, and bot-loop prevention
- verify channel updates stream and settle correctly
- verify early Slack feedback through reactions, assistant thread status, and live processing state
- leave room for default chat-first rendering instead of permanent raw tmux dumping

## Non-Goals

- API channel behavior
- backend runner design
- operator control surfaces

## Subtasks

- [x] prove end-to-end mention flow on `SLACK_TEST_CHANNEL`
- [x] prove killed-session recovery recreates the tmux session and continues the mapped Slack conversation
- [x] prove stored runner session-id resume works when the tmux session is recreated
- [x] prove no-mention thread follow-up in the live Slack app once the routed `message.channels` subscription is enabled for channel threads
- [ ] verify stale or duplicate events do not enqueue duplicate prompts
- [x] fix duplicate content settlement so `streaming: "all"` does not replay already-streamed content on completion
- [ ] verify bot-originated traffic is blocked by default unless explicitly allowed
- [ ] tighten Slack response formatting and failure handling where needed
- [ ] verify configured Slack ack, assistant status, and processing reactions behave correctly without becoming a delivery dependency
- [ ] keep Slack response handling compatible with the upcoming chat-first rendering and transcript-request policy

## Current Reality

- wrapped Codex prompt echoes and footer timing lines can leak into Slack if transcript shaping misses them
- killed tmux-session recovery is proven when the session has a stored runner `sessionId`
- runner session-id resume is working in the current runtime
- implicit no-mention follow-up depends on Slack delivering routed `message` events; `app_mention` alone is not enough
- live Slack validation on April 5, 2026 showed that `parent_user_id` in a human-started thread points to the thread root author, not to the bot that replied later
- latest OpenClaw `main` now matches the intended product behavior by remembering sent-thread participation after the bot has replied once in a Slack thread
- `muxbot` now models that target with session-scoped follow-up state
- live validation on April 5, 2026 proved that the missing blocker for channel-thread continuation was the Slack app subscription; after enabling `message.channels`, a plain no-mention reply in an activated thread reached the app and continued the same conversation

## Dependencies Or Blockers

- valid Slack app configuration and subscriptions, including the routed `message.channels`, `message.groups`, `message.im`, or `message.mpim` events needed for implicit follow-up delivery
- reachable `SLACK_TEST_CHANNEL`
- working runner path into the default agent session

## Related Docs

- [Channels Feature](../../../features/channels/README.md)
- [Slack Thread Follow-Up Behavior Research](../../../research/channels/2026-04-05-slack-thread-follow-up-behavior.md)
- [Chat-First Streaming And Transcript Request Commands](2026-04-04-chat-first-streaming-and-transcript-request-commands.md)
- [Channels Tests](../../../tests/features/channels/README.md)
