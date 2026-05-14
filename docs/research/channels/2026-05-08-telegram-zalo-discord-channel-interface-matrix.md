# Telegram, Official Zalo Bot, zca-js, Discord, And clisbot Channel Interface Matrix

## Summary

This note now evaluates channel surfaces against a simpler operator-facing grouping:

- `message`
- `group`
- `contact`

And one explicit extension rule:

- native-only features must be labeled clearly, whether they stay inside an existing group or move into a separate native extension surface

That is a better fit for the current `clisbot` decision than promoting many abstract top-level families too early.

The main conclusion is:

- this simpler grouping is supportable
- but support depth still varies sharply by provider
- so docs and CLI help must tell the truth about `native`, `compat`, `partial`, and `unsupported`

This file is an evidence and comparison note.

It should help shape the operator surface, but it should not become the canonical owner of shipped command truth. If the direction is adopted, that truth should move into CLI help and user-guide surfaces.

Naming note:

- `Official Zalo Bot` refers to the external platform capability surface
- `zalo-bot` refers to the current built-in `clisbot` provider id for that platform

The most important evidence-backed conclusions remain:

- current `clisbot` exposes `11` flat message verbs from `src/control/commands/message-cli.ts`
- Slack is not `11/11 native`
  - `poll` is a compatibility shim
  - `search` is a local filter over recent history
- Telegram is not flat-parity either
  - `pins` is only a partial single-pinned-message view
  - `read`, `reactions`, and `search` are explicitly unsupported
- current official Zalo Bot public docs expose only `9` API pages:
  - `getMe`
  - `getUpdates`
  - `setWebhook`
  - `deleteWebhook`
  - `getWebhookInfo`
  - `sendMessage`
  - `sendPhoto`
  - `sendSticker`
  - `sendChatAction`
- `zca-js` is much broader than official Zalo Bot and includes both group and contact behaviors
- Discord remains the strongest reference for rich group and native interaction surfaces

## Evidence Baseline

### clisbot current code

- `src/channels/message/message-command.ts`
  - defines the flat `MessageAction` union with `11` verbs
- `src/control/commands/message-cli.ts`
  - renders those `11` verbs in help
  - hard-codes `--thread-id` for Slack and `--topic-id` for Telegram
- `src/channels/slack/message-actions.ts`
  - `sendSlackPoll(...)` formats a compatibility poll over `sendSlackMessage(...)`
  - `searchSlackMessages(...)` reads recent history and filters locally
- `src/channels/telegram/message-actions.ts`
  - `sendTelegramPoll(...)` is native
  - `listTelegramPins(...)` reads `getChat().pinned_message`
  - `unsupportedTelegramHistoryAction(...)` blocks `read`, `reactions`, and `search`
- `src/channels/zalo-bot/plugin.ts`
  - current built-in `zalo-bot` message command path only supports `send`
- `src/channels/zalo-bot/message-actions.ts`
  - non-`send` actions return `unsupportedZaloBotHistoryAction(...)`

### Official docs and repo sources checked on `2026-05-08`

- Telegram Bot API
  - https://core.telegram.org/bots/api
- Official Zalo Bot docs
  - https://bot.zapps.me/docs/apis/getMe/
  - https://bot.zapps.me/docs/apis/getUpdates/
  - https://bot.zapps.me/docs/apis/setWebhook/
  - https://bot.zapps.me/docs/apis/deleteWebhook/
  - https://bot.zapps.me/docs/apis/getWebhookInfo/
  - https://bot.zapps.me/docs/apis/sendMessage/
  - https://bot.zapps.me/docs/apis/sendPhoto/
  - https://bot.zapps.me/docs/apis/sendSticker/
  - https://bot.zapps.me/docs/apis/sendChatAction/
- Discord official docs
  - https://docs.discord.com/developers/resources/message
  - https://docs.discord.com/developers/resources/channel
  - https://docs.discord.com/developers/platform/components
  - https://docs.discord.com/developers/interactions/receiving-and-responding
- `zca-js` public repo
  - https://github.com/RFS-ADRENO/zca-js
  - https://raw.githubusercontent.com/RFS-ADRENO/zca-js/main/src/index.ts

## Grouping Lens

### Why this grouping is better for now

The simpler grouping solves the more urgent problems:

- users can understand command intent faster
- read vs write vs admin risk is easier to see
- help text can stay compact
- new channels can join a shared model without immediately forcing a large taxonomy split

The grouped reading used in this note is:

| Group | What belongs here |
| --- | --- |
| `message` | send, edit, delete, react, pin, search, list, poll-like interactions |
| `group` | shared-container lifecycle, settings, members, and topic or thread-like subobjects |
| `contact` | personal graph, friends, direct relationship, alias or profile lookup |

Important clarification:

- this is an operator-surface grouping
- it does **not** force one exact internal code split
- native-only behavior is an extension rule, not automatically a peer top-level group

### High-level fit by group

| Group | Telegram Bot API | Official Zalo Bot API | `zca-js` | Discord | Reading |
| --- | --- | --- | --- | --- | --- |
| `message` | strong | thin | strong | strong | safest shared group |
| `group` | medium | very weak | strong | strong | best next expansion group |
| `contact` | weak | very weak | strong | weak or different semantics | shared only for some providers |

Native extension pressure:

- Telegram: medium
- Official Zalo Bot: narrow
- `zca-js`: broad
- Discord: broad

## Compatibility Matrix

### 1. Runtime bootstrap

| Group | Telegram Bot API | Official Zalo Bot API | `zca-js` | Discord | Reading |
| --- | --- | --- | --- | --- | --- |
| runtime bootstrap | strong | strong | different login/listener model | different gateway/interaction model | same operator family, different transport truth |

Evidence:

- Telegram and official Zalo Bot both expose `getMe`, `getUpdates`, `setWebhook`, `deleteWebhook`, `getWebhookInfo`
- `zca-js` is QR or cookie login plus listener runtime
- Discord is gateway and interactions first

### 2. `message`

#### `message` core

| Action reading | Telegram Bot API | Official Zalo Bot API | `zca-js` | Discord |
| --- | --- | --- | --- | --- |
| send text | native | native | native | native |
| reply in-context | native | not documented in current public slice | native-ish but different shape | native |
| send media | strong | thin but usable | strong | strong |
| edit | native | unsupported in current public slice | medium | native |
| delete | native | unsupported in current public slice | medium | native |
| react | native | unsupported in current public slice | medium | native |
| pin / unpin | native | unsupported in current public slice | not clean parity | native |

Evidence examples:

- Telegram: `sendMessage`, `sendPoll`, `editMessageText`, `deleteMessage`, `setMessageReaction`, `pinChatMessage`, `unpinChatMessage`
- Official Zalo Bot: `sendMessage`, `sendPhoto`, `sendSticker`, `sendChatAction`
- Discord: `Create Message`, `Edit Message`, `Delete Message`, `Pin Message`, `Unpin Message`, `Create Reaction`
- `zca-js`: `sendMessage`, attachment and link helpers, reaction and delete-like actions

Implication:

- `message` is the safest shared group, but official Zalo Bot stays thin inside it

#### `message` read-side actions

Recommended canonical names in this simpler model are:

- `message list`
- `message search`
- `message list-reactions`
- `message list-pins`

Matrix:

| Action reading | Telegram Bot API | Official Zalo Bot API | `zca-js` | Discord |
| --- | --- | --- | --- | --- |
| list recent messages | unsupported for current bot scope | unsupported in current public slice | stronger | medium |
| search messages | unsupported | unsupported | possible/richer local access | unclear from this pass; do not overclaim |
| list reactions | unsupported | unsupported | possible in some flows, but not standardized here | native |
| list pins | partial today in `clisbot` bot scope | unsupported | conversation pin state exists but not clean pinned-message parity | native |

Implication:

- read-side message actions are the biggest parity trap

#### `message` interaction slice

| Action reading | Telegram Bot API | Official Zalo Bot API | `zca-js` | Discord |
| --- | --- | --- | --- | --- |
| poll create | native | unsupported in current public slice | native-ish / rich | native |
| button or callback style flows | supported in broader bot platform | unsupported in current public slice | mixed | very strong |
| forms or modal-like flows | weak to medium | unsupported | weak to medium | strong |

Implication:

- polling and lightweight interaction still fit best under `message`

### 3. `group`

The simplified `group` lens intentionally includes:

- shared container lifecycle
- members
- topic or thread-like subcontainers

#### `group` lifecycle and settings

| Action reading | Telegram Bot API | Official Zalo Bot API | `zca-js` | Discord |
| --- | --- | --- | --- | --- |
| create or manage topic/thread-like object | medium | unsupported in current public slice | medium | strong |
| create or manage main shared container | limited in official bot scope | unsupported | stronger | strong |
| rename or edit group/container settings | limited | unsupported | stronger | strong |

Evidence examples:

- Telegram exposes forum-topic lifecycle and `message_thread_id`
- `zca-js` exposes `createGroup`, `changeGroupName`, `changeGroupAvatar`, `changeGroupOwner`, `joinGroupLink`, and related methods
- Discord official docs plus common server resources support channel and thread lifecycle strongly

Implication:

- this grouping is simpler for operators than splitting `thread`, `space`, and `participant` immediately

#### `group` members and moderation

| Action reading | Telegram Bot API | Official Zalo Bot API | `zca-js` | Discord |
| --- | --- | --- | --- | --- |
| member info / member count | native | unsupported in current public slice | strong | strong |
| member add / remove | limited | unsupported | strong | strong |
| role or admin changes | medium | unsupported | mixed | strong |
| timeout / kick / ban | medium | unsupported | mixed | strong |

Evidence examples:

- Telegram: `getChatMember`, `getChatMemberCount`, `banChatMember`, `restrictChatMember`, `promoteChatMember`
- `zca-js`: `getGroupInfo`, `getGroupMembersInfo`, `addUserToGroup`, `removeUserFromGroup`, `reviewPendingMemberRequest`
- Discord reference surfaces strongly support member and role admin

Implication:

- `group` is the next best shared expansion group after `message`

### 4. `contact`

| Action reading | Telegram Bot API | Official Zalo Bot API | `zca-js` | Discord |
| --- | --- | --- | --- | --- |
| list/search personal graph | not a main bot concept | unsupported in current public slice | strong | weak or not the same concept |
| add/remove friend or direct relation | not a main bot concept | unsupported in current public slice | strong | not the same concept |
| alias or lightweight person metadata | weak | unsupported | medium | different semantics |

Implication:

- `contact` is real only for some providers and should stay separate from `group`

### 5. Native extensions

| Provider | Native-only examples |
| --- | --- |
| Official Zalo Bot | currently very narrow beyond bootstrap/send/media/typing |
| `zca-js` | reminders, notes, quick messages, catalog-like workflows, broader personal-account powers |
| Discord | events, stage or voice-adjacent flows, richer guild artifacts, advanced interaction surfaces |
| Telegram | narrower in this note, but still has bot-specific interaction and moderation patterns |

Implication:

- native-only behavior should stay explicit instead of being flattened into fake-common commands

## clisbot Support Matrix Today

Scope:

- this section is only about built-in `clisbot` runtime channels today
- current built-ins under active comparison are Slack, Telegram, and `zalo-bot`
- `zca-js` and Discord are still reference surfaces here, not already-shipped built-ins of equal depth

### Current `message` support

| Current action | Slack now | Telegram now | Zalo Bot now | Better grouped reading |
| --- | --- | --- | --- | --- |
| `send` | `native` | `native` | `native` | `message send` |
| `poll` | `compat` | `native` | `unsupported` | `message poll-create` |
| `react` | `native` | `native` | `unsupported` | `message react` |
| `reactions` | `native` | `unsupported` | `unsupported` | `message list-reactions` |
| `read` | `partial` | `unsupported` | `unsupported` | `message list` |
| `edit` | `native` | `native` | `unsupported` | `message edit` |
| `delete` | `native` | `native` | `unsupported` | `message delete` |
| `pin` | `native` | `native` | `unsupported` | `message pin` |
| `unpin` | `native` | `native` | `unsupported` | `message unpin` |
| `pins` | `native` | `partial` | `unsupported` | `message list-pins` |
| `search` | `compat` | `unsupported` | `unsupported` | `message search` |

### Truthful support counts

| Channel | Native | Compat | Partial | Unsupported |
| --- | --- | --- | --- | --- |
| Slack | `8` | `2` | `1` | `0` |
| Telegram | `7` | `0` | `1` | `3` |
| Zalo Bot | `1` | `0` | `0` | `10` |

Important reading:

- these numbers only matter when paired with the support label
- a flat “supported” badge is too misleading

### Current built-in operator caveats

These are already part of shipped help or user-guide truth and should not get lost in a future regrouping:

| Channel | Current operator caveats from help/docs |
| --- | --- |
| Slack | uses `--thread-id`; `native` rendering means Slack `mrkdwn`; `poll` and `search` are exposed in help even though they are not both fully native |
| Telegram | uses `--topic-id`; `native` rendering means Telegram-safe HTML; `pins` is currently only the single `pinned_message` view |
| `zalo-bot` | no `--thread-id` or `--topic-id`; `native` rendering is readable plain text; media send currently expects an absolute HTTP or HTTPS URL; current built-in message command support is `send` only even though generic `message` help still advertises the wider verb family |

This is one reason the next step should be help and user-guide clarification, not only internal taxonomy cleanup.

## What This Means For The Proposal

1. The simpler grouped CLI surface is viable.
2. `message` should remain the first-class shared group.
3. `group` is the next best expansion group because it is operator-meaningful and spans lifecycle plus members.
4. `contact` should exist, but only some providers will populate it well.
5. native-only extensions must stay explicit.
6. Help and docs are more important than enforcing one internal decomposition path.

The practical reading is:

- start by cleaning naming and help inside `message`
- expand to `group` only when lifecycle plus member management should ship together
- do not let `contact` become mandatory for channels where that object is not real
- use native extensions as an honest escape hatch, not as a dumping ground for unclear shared design

## Recommendation By Channel

### Official Zalo Bot

Best fit:

- runtime bootstrap
- `message send`
- media send where supported
- typing or processing signal

Bad fit for parity promises today:

- `message` read-side actions
- `group`
- `contact`

### zca-js

Best fit:

- richer `message`
- stronger `group`
- meaningful `contact`
- substantial native-extension pressure

But it should stay clearly marked as unofficial or higher-risk.

### Discord

Best fit:

- rich `message`
- very strong `group`
- very strong interaction patterns
- meaningful native-only surface

### Telegram

Best fit:

- strong official-bot `message` core
- some `group` depth through topic or moderation primitives
- weaker read-side `message` parity than the flat verb list might imply

## Follow-Up

- [clisbot v2 Channel Tool Surface Proposal](./2026-05-08-clisbot-v2-channel-tool-surface-proposal.md)
