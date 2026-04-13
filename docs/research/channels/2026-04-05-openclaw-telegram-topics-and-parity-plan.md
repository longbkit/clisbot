# OpenClaw Telegram Topics And Slack-Parity Plan

## Summary

This research maps how OpenClaw models Telegram, especially forum topics, and what `clisbot` should copy if it wants Telegram support that feels consistent with the Slack feature set already in flight.

Main conclusion:

- OpenClaw treats Telegram topics as first-class conversation surfaces, not as a lightweight follow-up cache like Slack threads
- Telegram topics are the closest Telegram equivalent to Slack threads, but the mental model is different
- in `clisbot`, Telegram should be added as a new channel surface with topic-aware routing, session isolation, and topic-aware reply placement
- Slack-style follow-up participation state should not be copied blindly into Telegram topics because Telegram already provides a concrete topic identifier on inbound messages

## Scope

This note focuses on:

- OpenClaw Telegram tech stack
- Telegram session and topic identity
- Telegram config shape and topic inheritance
- reply, typing, commands, and streaming behavior in topics
- a parity plan against current `clisbot` Slack behavior

This note does not define final `clisbot` implementation details yet.

## Source Baseline

Local OpenClaw reference used for this analysis:

- repo: `https://github.com/openclaw/openclaw/tree/develop`
- branch: `develop`
- commit: `e78ae48e69`

Important constraint:

- this note is truthful to the local checkout above plus its docs
- if strict parity with latest OpenClaw `main` becomes important before implementation starts, Telegram source should be re-checked on `main` first

## Key Sources

- [OpenClaw Telegram Docs](https://github.com/openclaw/openclaw/blob/develop/docs/channels/telegram.md)
- [OpenClaw grammY Docs](https://github.com/openclaw/openclaw/blob/develop/docs/channels/grammy.md)
- [OpenClaw Session Docs](https://github.com/openclaw/openclaw/blob/develop/docs/concepts/session.md)
- [OpenClaw Telegram Config Types](https://github.com/openclaw/openclaw/blob/develop/src/config/types.telegram.ts)
- [OpenClaw Telegram Bot](https://github.com/openclaw/openclaw/blob/develop/src/telegram/bot.ts)
- [OpenClaw Telegram Helpers](https://github.com/openclaw/openclaw/blob/develop/src/telegram/bot/helpers.ts)
- [OpenClaw Telegram Message Context](https://github.com/openclaw/openclaw/blob/develop/src/telegram/bot-message-context.ts)
- [OpenClaw Telegram Message Dispatch](https://github.com/openclaw/openclaw/blob/develop/src/telegram/bot-message-dispatch.ts)
- [OpenClaw Telegram Delivery](https://github.com/openclaw/openclaw/blob/develop/src/telegram/bot/delivery.ts)
- [OpenClaw Session Key Helpers](https://github.com/openclaw/openclaw/blob/develop/src/routing/session-key.ts)
- [OpenClaw Channel Config Matching](https://github.com/openclaw/openclaw/blob/develop/src/channels/channel-config.ts)
- [OpenClaw Telegram Tests](https://github.com/openclaw/openclaw/blob/develop/src/telegram/bot.test.ts)

## OpenClaw Telegram Tech Stack

OpenClaw Telegram is built on Telegram Bot API through `grammY`.

Important implementation choices:

- `grammY` is the only Telegram client path
- long-polling is the default transport
- webhook mode is optional
- `@grammyjs/runner` `sequentialize()` is used so inbound work is sequenced per chat or per topic-like key
- `@grammyjs/transformer-throttler` is installed by default
- Telegram API access is wrapped with explicit error logging helpers

What this means for `clisbot`:

- Telegram support should not be modeled like Slack Socket Mode
- KISS path is long-polling first
- the inbound concurrency model should preserve per-conversation order, especially for group topics

## OpenClaw Telegram Conversation Model

### 1. DMs

OpenClaw docs say Telegram DMs share the agent main session by default.

That aligns with OpenClaw’s general session model:

- default direct-message scope is continuity-first
- DM access is controlled separately by `dmPolicy`

### 2. Groups

Telegram groups are isolated sessions:

- `agent:<agentId>:telegram:group:<chatId>`

This is the Telegram equivalent of a non-DM Slack surface.

### 3. Forum Topics

Telegram forum topics are first-class sub-surfaces identified by `message_thread_id`.

OpenClaw isolates them by appending a topic suffix:

- `agent:<agentId>:telegram:group:<chatId>:topic:<threadId>`

This is the most important design point to carry over.

Slack thread support in `clisbot` currently needs follow-up policy state because Slack thread continuation is partly inferred from bot participation.

Telegram topics are different:

- the topic id arrives in the inbound event
- no Slack-style participation cache is required just to know which conversation surface the message belongs to

### 4. General Topic

Telegram forum supergroups have a special General topic:

- topic id `1`

OpenClaw source treats it specially:

- session identity still uses topic `1`
- typing indicators still include `message_thread_id: 1`
- normal message sends omit `message_thread_id` because Telegram rejects it for the General topic

This is a real transport rule, not a cosmetic detail.

### 5. Non-Forum Group Threads

OpenClaw explicitly ignores `message_thread_id` in non-forum groups for session isolation.

Meaning:

- only forum topics create separate group sessions
- ordinary reply chains in non-forum groups do not become separate sessions

That should be copied into `clisbot` to avoid accidental over-fragmentation.

## Topic-Aware Config Model In OpenClaw

OpenClaw Telegram config is multi-layered:

- `channels.telegram`
- `channels.telegram.accounts.<accountId>`
- `channels.telegram.groups.<chatId>`
- `channels.telegram.groups.<chatId>.topics.<threadId>`

Important Telegram-specific config surfaces:

- `botToken`
- `dmPolicy`
- `groups`
- `replyToMode`
- `streamMode`
- `groupPolicy`
- `groupAllowFrom`
- `historyLimit`
- `dmHistoryLimit`
- `customCommands`
- `reactionNotifications`
- `reactionLevel`

Topic config supports:

- `requireMention`
- `groupPolicy`
- `skills`
- `enabled`
- `allowFrom`
- `systemPrompt`

## Topic Inheritance Rules

OpenClaw source and tests show this inheritance model:

- topic config inherits parent group config by default
- topic config can override `requireMention`
- topic config can override `allowFrom`
- topic config can override `skills`
- topic config can append its own `systemPrompt`
- topic config can disable the bot for a single topic even when the group stays enabled

This is important because it is much simpler than inventing a second parallel route system.

For `clisbot`, the clean rule is:

- Telegram topics should inherit their parent group route config unless a topic override exists

## Mention And Access Gating In OpenClaw Telegram

OpenClaw splits Telegram access into separate concerns:

- DM access policy
- group allowlist
- sender allowlist
- mention gating

These are not one setting.

### DM Side

DMs are controlled by `dmPolicy`:

- `pairing`
- `allowlist`
- `open`
- `disabled`

### Group Side

Groups have two independent gates:

- which groups are allowed
- which senders in those groups are allowed

OpenClaw uses:

- `groups` as a group allowlist surface
- `groupPolicy` as sender-level behavior
- `requireMention` as a separate mention gate

This is cleaner than flattening everything into a single `requireMention` concept.

## Reply Placement And Typing In Topics

OpenClaw keeps reply placement topic-aware:

- typing uses `message_thread_id`
- replies use `message_thread_id`
- native command replies also stay in the topic

The important exception is General topic sending:

- typing still uses `message_thread_id: 1`
- message sends omit `message_thread_id`

For `clisbot`, this means Telegram topic support is not just routing.

It also requires topic-aware outbound delivery rules.

## Streaming In OpenClaw Telegram

OpenClaw Telegram streaming is not the same as the current `clisbot` Slack strategy.

OpenClaw documents:

- `streamMode: "off" | "partial" | "block"`
- draft streaming is DM-only
- draft streaming requires private threaded chats and topic-enabled bot capability

Important implication:

- OpenClaw’s Telegram streaming path is specialized
- it is not a general "edit one visible message in any Telegram surface" rule

For `clisbot`, there are two different choices:

1. copy OpenClaw’s Telegram-specific draft behavior
2. keep the current generic channel contract and implement Telegram edited live replies with the same normalized runner stream used for Slack

For this project, option 2 is cleaner for MVP because:

- `clisbot` already has a generic chat-first rendering model
- the system goal is channel reuse of one runner output contract
- Telegram draft streaming is interesting, but it is not required to reach Slack-level feature parity

## Native Commands In OpenClaw Telegram

OpenClaw registers Telegram native commands through the bot menu.

It supports:

- native command registration on startup
- custom menu commands via config
- command handling inside topics

This maps well to the current `clisbot` control-command direction.

For `clisbot`, Telegram should support the same control-command vocabulary where practical:

- `/transcript`
- `/stop`
- `/bash`
- `/followup`

And Telegram should additionally be able to expose them as native Telegram slash commands.

## Reaction Behavior In OpenClaw Telegram

OpenClaw Telegram also models reactions, but differently from Slack.

Relevant config:

- `reactionNotifications`
- `reactionLevel`

Key difference from Slack:

- Slack currently has explicit UX surfaces already implemented in `clisbot`: ack reaction, assistant processing status, and live edited reply
- OpenClaw Telegram does not provide a Slack-style assistant-status equivalent

For `clisbot`, Telegram processing feedback should be planned as:

- typing indicator first
- live reply second
- ack reaction only if it is both supported and useful
- no assumption of an assistant-status equivalent

## Important Doc And Source Discrepancy

OpenClaw Telegram docs say:

- private chats can include `message_thread_id`
- DM session key stays unchanged
- thread id is only used for replies and draft streaming

But the source in `bot-message-context.ts` passes DM `message_thread_id` through `resolveThreadSessionKeys()`, which can append:

- `:thread:<threadId>`

So, as of the inspected checkout, there is a discrepancy:

- docs describe DM thread ids as transport-only
- source appears able to create DM thread session suffixes

This matters for `clisbot` because it should choose one model explicitly instead of copying ambiguity.

Recommended `clisbot` choice:

- do not introduce Telegram DM thread session splitting in the first Telegram MVP
- keep DM continuity rules aligned with existing agent session policy unless a strong use case appears

## What Telegram Topics Mean For `clisbot`

### Telegram Topics Are Not Slack Follow-Up State

This is the most important architectural takeaway.

Slack thread continuation currently needs policy state:

- mention gating
- follow-up override
- participation TTL

Telegram topics do not need that just to identify the conversation surface.

Telegram topics should instead be modeled as:

- a first-class routed surface inside the Telegram channel

That means:

- Slack follow-up policy remains a channel-specific behavior
- Telegram topic routing remains a Telegram channel identity behavior

Do not mix them.

### Telegram Needs Topic-Aware Route Resolution

The route lookup should conceptually be:

1. account
2. chat type
3. chat id
4. topic id if present and forum-enabled
5. fallback to parent group config if no topic override exists

### Telegram Needs Topic-Aware Outbound Delivery

Outbound delivery must know:

- whether the chat is a forum supergroup
- whether the target is the General topic
- whether typing and reply threading should use `message_thread_id`

This belongs in the Telegram channel adapter, not in the agents layer.

## Slack-Parity Plan For `clisbot`

The goal is not to make Telegram identical to Slack.

The goal is to make Telegram satisfy the same product promises where those promises make sense.

## Parity Matrix

| Current Slack capability in `clisbot` | Telegram equivalent | Parity shape |
| --- | --- | --- |
| Channel route to one agent | Telegram account/group/topic route to one agent | Direct |
| One conversation surface maps to one `sessionKey` | Topic-specific `sessionKey` using `:topic:<threadId>` | Direct |
| Thread continuation in same surface | Same topic naturally continues because inbound `message_thread_id` identifies the surface | Adapted |
| `requireMention` gating on shared surfaces | `requireMention` on groups and per-topic override | Direct |
| DM default without mention | DM `requireMention: false` equivalent through DM route policy | Direct |
| Live processing feedback | typing indicator plus live reply | Adapted |
| Ack reaction on inbound message | optional Telegram reaction, later | Deferred |
| Slack assistant status | no real Telegram equivalent | Not applicable |
| Edited streaming reply | Telegram message edit path if reliable | Adapted |
| Final-only settlement | same normalized channel contract | Direct |
| Slash control commands | Telegram slash commands and plain text commands | Direct |
| Transcript request command | Telegram `/transcript` reply in same chat/topic | Direct |
| Stop current run | Telegram `/stop` routed to same session | Direct |
| Bash helper command | Telegram `/bash` routed to same agent session | Direct |

## Recommended MVP Order

### Phase 1: Telegram Channel Foundation

- Telegram long-polling transport
- one configured bot account
- DM, group, and topic conversation-kind detection
- OpenClaw-like config layout for `channels.telegram`
- topic-aware session keys

### Phase 2: Telegram Topic-Safe Conversation Behavior

- topic-aware inbound routing
- group inheritance plus topic overrides
- topic-aware reply placement
- topic-aware typing indicators
- General topic special-case handling

### Phase 3: Match Current Slack User-Level Controls

- Telegram support for `/transcript`
- Telegram support for `/stop`
- Telegram support for `/bash`
- Telegram support for `/followup` only where it makes semantic sense

Important note:

- `/followup` is mostly a Slack-style policy concept
- Telegram topics already have stable surface identity
- if Telegram gets `/followup`, it should probably control mention-gating behavior, not topic identity

### Phase 4: Match Current Slack Presentation Contract

- default chat-first rendering
- `streaming: off | latest | all`
- `response: all | final`
- edited live reply when safe
- long-message chunk reconciliation for edited updates

### Phase 5: Telegram-Specific Enhancements

- native Telegram command menu registration
- multi-account support
- reactions
- webhook mode
- Telegram-specific draft streaming if it is still worth the complexity

## Recommended Config Shape For `clisbot`

To stay compatible with OpenClaw mental models, Telegram config should follow this shape:

```json5
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "${TELEGRAM_BOT_TOKEN}",
      transport: "polling",
      dmPolicy: "pairing",
      streaming: "all",
      response: "final",
      replyToMode: "first",
      groups: {
        "*": {
          requireMention: true,
        },
        "-1001234567890": {
          requireMention: false,
          topics: {
            "99": {
              requireMention: false,
            },
          },
        },
      },
    },
  },
}
```

Guidance:

- keep `streaming` and `response` aligned with the existing `clisbot` cross-channel rendering contract
- keep Telegram-specific transport knobs under `channels.telegram`
- keep topic overrides inside the Telegram channel subtree, not in the agents layer

## Recommended Architectural Mapping In `clisbot`

### Channels

Channels should own:

- Telegram transport
- Telegram event normalization
- topic-aware reply placement
- topic-aware live message editing
- typing indicator behavior

### Agents

The agents layer should own:

- `agentId`
- `sessionKey`
- persistent session state
- control-command routing once the Telegram message is accepted

### Runners

Runners should stay unchanged:

- they do not care whether the request came from Slack thread or Telegram topic
- they only receive normalized input for one `sessionKey`

## Recommendation

Build Telegram as a first-class channel with topic-aware routing and reply placement, but do not import Slack follow-up semantics into Telegram unnecessarily.

The clean product rule is:

- Slack threads need follow-up policy
- Telegram topics need topic identity and topic-safe delivery

That keeps the system simple and truthful.
