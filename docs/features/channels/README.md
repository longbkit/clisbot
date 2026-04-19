# Channels

## Summary

Channels is the user-facing surface system in `clisbot`.

It owns every external conversation surface:

- Slack today
- Telegram today
- API-compatible access as another channel
- planned Zalo expansion as three distinct paths:
  - `zalo-bot`
  - `zalo-oa`
  - `zalo-personal`
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
- observer-style run control commands such as attach, detach, and interval watch on active long-running sessions
- channel-ingestion concurrency so one long-running conversation does not block unrelated conversations on the same channel account
- bounded recent-message replay so a later mention can recover the last few ignored routed messages without replaying whole-channel history

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
- [OpenClaw CLI Command Surfaces And Slack Telegram Send Syntax](../../research/channels/2026-04-09-openclaw-cli-command-surfaces-and-slack-telegram-send-syntax.md)
- [OpenClaw Channel Standardization Vs Clisbot Gaps](../../research/channels/2026-04-10-openclaw-channel-standardization-vs-clisbot-gaps.md)
- [OpenClaw Structured Channel Rendering Techniques For Slack And Telegram](../../research/channels/2026-04-14-openclaw-structured-channel-rendering-techniques.md)
- [OpenClaw Zalo Paths And Official Zalo Bot Platform](../../research/channels/2026-04-18-openclaw-zalo-paths-and-official-zalo-bot-platform.md)

## Related Feature Docs

- [Message Actions And Bot Routing](message-actions-and-channel-accounts.md)
- [Message Command Formatting And Render Modes](message-command-formatting-and-render-modes.md)
- [Agent Progress Reply Wrapper And Prompt](agent-progress-reply-wrapper-and-prompt.md)
- [Streaming Mode And Message-Tool Draft Preview Handoff](streaming-mode-and-message-tool-draft-preview-handoff.md)
- [Prompt Templates](prompt-templates.md)
- [Transcript Visibility And Verbose Levels](transcript-visibility-and-verbose-levels.md)
- [Structured Channel Rendering And Native Surface Capabilities](structured-channel-rendering-and-native-surface-capabilities.md)
- [Loop Slash Command](loop-slash-command.md)
- [Recent Conversation Replay](recent-conversation-replay.md)
- [Zalo Bot, Zalo OA, And Zalo Personal Channel Strategy](../../tasks/features/channels/2026-04-18-zalo-bot-oa-and-personal-channel-strategy.md)
- [Official Zalo Bot Platform Channel MVP](../../tasks/features/channels/2026-04-18-zalo-bot-platform-channel-mvp.md)

## Dependencies

- [Agents](../agents/README.md)
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
- current `clisbot` now reaches that same user-visible rule with session-scoped follow-up state
- live validation on April 5, 2026 proved that enabling Slack `message.channels` unblocked natural no-mention continuation for channel threads after the bot had already replied once
- direct-message access control now follows an OpenClaw-shaped gate before session routing:
  - `open` accepts the sender immediately
  - `pairing` issues a pairing code for unknown senders
  - `allowlist` admits only configured or previously approved senders
  - `disabled` ignores the DM surface
- Slack and Telegram direct messages now default to `policy: "pairing"` to match OpenClaw
- shared surfaces keep the OpenClaw-style secure posture of `allowlist` plus `requireMention: true` by default
- unrouted shared-surface onboarding guidance now follows one shared policy layer: Slack explicit mentions still surface route guidance, and Telegram group or topic explicit mentions now do the same while keeping Telegram-native slash onboarding
- OpenClaw’s Slack-only sparse-config fallback to `groupPolicy: "open"` is documented as research nuance, not copied as a `clisbot` default
- Slack should acknowledge accepted inbound messages immediately with a configurable reaction, Slack assistant thread status, and a live in-thread processing reply
- default Slack feedback should keep `ackReaction: ""`, `typingReaction: ""`, and `processingStatus.enabled: true`
- active long-running sessions should support `/attach`, `/detach`, and `/watch every <duration>` so users can control how this thread follows the run without switching to raw transcript by default
- routed conversations now also support `/loop` for bounded repeated prompts, managed interval loops, and wall-clock loops such as `every day at 07:00`, with `LOOP.md` as the maintenance fallback when no prompt is supplied and `/loop status` or `/loop cancel` for active loop control
- current observer scope is per thread for a routed conversation, so running `/attach` or `/watch` again in the same thread replaces the earlier observer mode for that thread
- current `/detach` behavior is sparse-follow rather than silent unsubscribe: live updates stop, sparse progress can continue, and final settlement still returns to the same thread when the run completes
- channel observer delivery is now explicitly best-effort: transient Slack or Telegram send or edit failures may miss intermediate updates, but they must not terminate runner supervision or require a process restart
- `/status` on a routed thread should expose the current session run state so users can see active detached work without switching to transcript-first inspection
- Slack and Telegram now keep only the latest 5 routed inbound messages per conversation boundary plus a `lastProcessedMarker`, then replay only the unprocessed tail when a later invocation needs recent context
- expand the same channel model to the API surface next
- Telegram now ships as a topic-aware channel surface, using OpenClaw-style group and topic config inheritance instead of reusing Slack follow-up mechanics for topic identity
- Telegram transport should respect Telegram Bot API retry-after hints and pace live message edits so streaming does not fail on 429 rate limits
- Telegram processing feedback should keep a topic-aware typing heartbeat alive while work is still running, following OpenClaw's documented rule that typing remains scoped to the active topic
- Telegram polling should dispatch updates without global in-order blocking, so one busy topic or DM does not stall later updates for other topics or chats on the same bot
- Slack and Telegram now share a first-class `ChannelPlugin` seam for runtime bootstrap, operator `message` commands, runtime health summaries, and shared route-policy composition
- provider event loops, payload parsing, and transport semantics still stay provider-owned, so a future channel can plug into the same control seam without flattening provider behavior
- the next Vietnam channel expansion is now explicitly shaped as three separate provider families:
  - `zalo-bot` first
  - `zalo-oa` second
  - `zalo-personal` optional last
- `zalo-bot` should reuse Telegram-like architecture patterns where they fit, but keep Zalo-specific transport, policy, and limit semantics truthful
