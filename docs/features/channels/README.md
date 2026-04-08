# Channels

## Summary

Channels is the user-facing surface system in `muxbot`.

It owns every external conversation surface:

- Slack today
- Telegram today
- API-compatible access as another channel
- future Discord and similar integrations

## State

Active

## Why It Exists

The project goal is to expose subscription-backed coding agents through practical access surfaces, not only through direct API usage.

Channels is where those surfaces live.

## Scope

- inbound message and request handling
- inbound file and attachment intake from supported channels
- conversation-kind detection such as Slack `dm`, `group`, and `channel`
- topic-aware conversation-kind detection for channels that support first-class sub-surfaces such as Telegram forum topics
- direct-message access control such as `open`, `pairing`, `allowlist`, and `disabled`
- pairing-code reply flows for gated direct-message onboarding
- slash-prefixed conversation commands at the channel boundary
- outbound replies and streaming updates
- early user-visible processing feedback such as inbound ack reactions, Slack assistant thread status, and live in-thread processing replies
- thread and reply behavior
- channel transport behavior such as message edit support versus append-only fallback
- long-message chunk reconciliation for channels that support edited live replies
- default chat-first rendering per channel
- user-visible transcript shaping from normalized runner output, including top and bottom chrome stripping where needed
- explicit transcript request command patterns for whole-session visibility when users ask for it
- channel-ingestion concurrency so one long-running conversation does not block unrelated conversations on the same channel account

## Non-Goals

- backend-specific runner mechanics
- canonical agent session ownership rules
- operator-only control actions

## Related Task Folder

- [docs/tasks/features/channels](../../tasks/features/channels)

## Related Test Docs

- [docs/tests/features/channels](../../tests/features/channels/README.md)

## Related Research

- [Slack Thread Follow-Up Behavior](../../research/channels/2026-04-05-slack-thread-follow-up-behavior.md)
- [OpenClaw Telegram Topics And Slack-Parity Plan](../../research/channels/2026-04-05-openclaw-telegram-topics-and-parity-plan.md)
- [OpenClaw Pairing Implementation](../../research/channels/2026-04-06-openclaw-pairing-implementation.md)

## Dependencies

- [Agent-OS](../agent-os/README.md)
- [Runners](../runners/README.md)
- [Configuration](../configuration/README.md)
- [Transcript Presentation And Streaming](../../architecture/transcript-presentation-and-streaming.md)

## Current Focus

Keep the Slack MVP truthful on `SLACK_TEST_CHANNEL`.

- thread-backed Slack conversations are isolated by session key
- killed tmux-session recovery with stored runner session-id resume is proven
- implicit no-mention thread follow-up depends on Slack app `message.*` event subscriptions for the routed conversation kind
- live Slack validation proved that `parent_user_id` in a human-started thread is the thread root author, so root-author-only gating is not truthful for general Slack thread continuation
- latest OpenClaw `main` now models Slack follow-up as "the bot has already replied in this thread" via a sent-thread participation cache
- current `muxbot` now reaches that same user-visible rule with session-scoped follow-up state
- live validation on April 5, 2026 proved that enabling Slack `message.channels` unblocked natural no-mention continuation for channel threads after the bot had already replied once
- direct-message access control now follows an OpenClaw-shaped gate before session routing:
  - `open` accepts the sender immediately
  - `pairing` issues a pairing code for unknown senders
  - `allowlist` admits only configured or previously approved senders
  - `disabled` ignores the DM surface
- Slack and Telegram direct messages now default to `policy: "pairing"` to match OpenClaw
- shared surfaces keep the OpenClaw-style secure posture of `allowlist` plus `requireMention: true` by default
- OpenClaw’s Slack-only sparse-config fallback to `groupPolicy: "open"` is documented as research nuance, not copied as a `muxbot` default
- Slack should acknowledge accepted inbound messages immediately with a configurable reaction, Slack assistant thread status, and a live in-thread processing reply
- default Slack feedback should keep `ackReaction: ":heavy_check_mark:"`, `typingReaction: ""`, and `processingStatus.enabled: true`
- expand the same channel model to the API surface next
- Telegram now ships as a topic-aware channel surface, using OpenClaw-style group and topic config inheritance instead of reusing Slack follow-up mechanics for topic identity
- Telegram transport should respect Telegram Bot API retry-after hints and pace live message edits so streaming does not fail on 429 rate limits
- Telegram polling should dispatch updates without global in-order blocking, so one busy topic or DM does not stall later updates for other topics or chats on the same bot
