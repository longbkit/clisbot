# Inbound — the flat `ctxPayload`

The seam's `InboundReplyParams.ctxPayload` is OpenClaw's `BuiltChannelInboundEventContext` = `FinalizedMsgContext & {Body, BodyForAgent, BodyForCommands, ChatType, CommandAuthorized, CommandBody, From, RawBody, SessionKey, To, InboundEventKind}` (`main/dist/types-DaHgOqFX.d.ts:7980`), built by `buildChannelInboundEventContext` (`main/dist/kernel-BMsNZe7F.js:269-345`). It is **flat** — there is no nested `conversation` object, no `messageId` key, no `sender` object.

## The fields the normalizer reads

From `MsgContext` / the builder (names are exact; `main/dist/templating--GHupcKJ.d.ts:131-363` + the kernel builder):

- `Body` — the message text (`message.body ?? rawBody`). Use this for the plane's `text`.
- `BodyForAgent` — the agent-facing text.
- `From` — the sender's native id (params.from).
- `To` — the reply target.
- `ChatType` — the native conversation kind (see below).
- `ChatId` — the native conversation id (params.conversation.id).
- `ConversationLabel` — the display label.
- `MessageSid` — the native message id (Slack ts / Telegram message id).
- `Timestamp` — milliseconds.
- `SenderId` / `SenderName` / `SenderUsername` — the sender, as the **raw native id** (Slack `U…` / Telegram numeric). The plane's identity model is `<channel>:<provider-id>` (impl doc §4.3.2), so the normalizer applies the `<channel>:` prefix at the native → plane boundary (`supervisor/index.ts` `flatInboundNormalizer`); neither vertical prefixes it.
- `WasMentioned` — `access.mentions.wasMentioned`.
- `MessageThreadId` — the native thread/topic id (`params.reply.messageThreadId ?? params.conversation.threadId`); `string | number`, undefined at root level.
- `NativeChannelId` — the native channel id.
- `CommandAuthorized` — always a boolean (default-deny false).
- `AccountId`, `AgentId`, `SessionKey`, `OriginatingChannel`, `OriginatingTo` — context, not decision inputs.
- `EventKind` — **Fusion-owned addition** (slice 23a), always present. The inbound FAMILY: `message | command | callback | edit | delete | reaction | member | channel | pin | topic | poll_answer | interactive`. Upstream carries a coarser `InboundEventKind` (`user_request | room_event`, `src/channels/inbound-event/classification.ts`); Fusion keeps the platform family and derives the wake/no-wake split from it. An event with no key reads as `message`, so a vertical written before the field existed is unchanged.
- `EventFacts` — **Fusion-owned addition**, present only when the family carries structured facts. One nested object, not flat keys: the Hub reads it as a unit after branching on `EventKind`. Members (all optional): `command {name, args}`, `callback {actionId, value?, actorId, messageId?}`, `reaction {emoji, added, messageId, actorId}`, `target {messageId}` (the message an edit/delete/pin acts on — the event's own `MessageSid` is its dedupe identity, not its subject), `member {userId, joined}`, `pollAnswer {pollId, optionIds, voterId}`, `topic {threadId?, name?, event}`. The shapes live on `ChannelInboundEvent` in `packages/channels/shared/src/monitor.ts`.

## Native conversation kinds

- **Slack** (`slack/dist/provider-C1-DFSpw.js` `resolveSlackChatType`): `im` → `direct`, `mpim` → `group`, else `channel`. Threads are NOT a kind: a threaded message keeps `ChatType: "channel"` and carries `MessageThreadId` (the thread ts; `slack/dist/pipeline.runtime-rpVpay59.js:3479, 3480-3545`).
- **Telegram**: `direct` (DM), `group` (basic + forum groups; a topic message is still `group` with its topic id in `MessageThreadId`/the peer id).

## Native → plane mapping

The plane's `InboundConversationDetail` (`plane/types.ts`) is `{kind, id, rootConversationId, threadId}` where `kind` is the route-match vocabulary. The mapping:

| native                              | plane `kind` / `id` / `threadId` / `rootConversationId` |
| ----------------------------------- | ------------------------------------------------------- |
| Slack `direct`                      | `dm` / peer id / null / peer id                         |
| Slack `group` (mpim)                | `group` / group id / null / group id                    |
| Slack `channel`, top-level          | `channel` / channel id / null / channel id              |
| Slack `channel` + `MessageThreadId` | `thread` / thread ts / thread ts / channel id           |
| Telegram `direct`                   | `dm` / chat id / null / chat id                         |
| Telegram `group`, no topic          | `group` / chat id / null / chat id                      |
| Telegram `group` + topic            | `topic` / topic id / topic id / chat id                 |

## Two-pass route matching (the decision)

`matchRoute` is a single-level first-match (a route's `kind` must equal the descriptor's `kind`, impl doc §4.3.6). The doc's own route examples (§4.3.3 L514-527) force two passes in the facade (`execution.ts` `resolveRoute`), not in `matchRoute`:

- `match: {kind: channel, ids: [C0INFRA]}` + `binding.key: channel` must also admit the channel's threads ("whole #infra = one session, incl. all its threads", L525).
- `match: {kind: thread, ids: [C0THREAD]}` (declared AFTER the channel routes) must still win for that thread (L527; mirrors OpenClaw's "the thread key is more specific" session-key model, §4.3.4).

So: match the **thread/topic-level descriptor first** (for a threaded message: `{kind: thread|topic, id: threadId}`), then the **root descriptor** (`{kind: dm|channel|group, id: rootConversationId}`); first hit in declaration order wins. The binding row stores the **matched-level descriptor** so re-attach re-matches at the same level (a thread that matched at thread level must not re-fall through to a root route; `routeForBinding`). `deriveBindingKey` is unaffected — it reads `threadId` / `rootConversationId`, not the route descriptor.

## What each family is allowed to do (`plane/inbound-kinds.ts`)

The family, not the text, decides whether an event may start a turn. Without this a route with `requireMention: false` forwarded "Slack reaction added: :+1: …" and "[Joined] Ann" to the agent as user text.

| `EventKind`                                                              | plane behaviour                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message`                                                                | The normal path: identity link, approval command, session command, route match, binding, agent turn.                                                                                                                                                                                                                                                    |
| `command`                                                                | The shared session commands (`commands.ts`): `/status`, `/stop`, `/new`, `/help`, `/approve`, `/deny`. `EventFacts.command.name` names the verb, so a Slack native slash command (whose text carries no `/`) and a Telegram `/verb` line reach the same alias table. A verb this Hub does not own is forwarded as text only when the bot was addressed. |
| `callback`, `interactive`                                                | The value decodes as an approval card → the one exactly-once approval resolver (the same entry a native card click takes, both authority checks included). Else the action id decodes as a session command → run it. Else ignored with a log.                                                                                                           |
| `edit`                                                                   | Room activity by default; `defaults.inbound.editNotifications: all` re-runs the edited message as a message.                                                                                                                                                                                                                                            |
| `delete`, `reaction`, `member`, `channel`, `pin`, `topic`, `poll_answer` | Never start a turn. Recorded in channel inbound activity against the route that owns the conversation. `reaction` is recorded only when `defaults.inbound.reactionNotifications` is not `off`.                                                                                                                                                          |

The table is code, not config: which families may wake an agent is a product fact. `ChannelInboundKind` is exhaustive over the table, so adding a family without stating its disposition is a type error.

### The two operator knobs

`defaults.inbound` folds through org < account < route like every other defaults leaf.

- `reactionNotifications: off | own | all` — upstream's name and values (`buildChannelReactionShape` in each channel's `config-schema.ts`), so an account authored for OpenClaw compiles unchanged. Fusion never wakes an agent on a reaction, so the leaf only gates recording; `own` and `all` behave alike until the Hub can tell whose message was reacted to. Floor: `off`.
- `editNotifications: off | all` — upstream has no leaf for inbound edits; the name follows upstream's `*Notifications` family. Floor: `off`.

### `/new`

The daemon has no session-reset RPC and does not need one: the plane owns the conversation → agent map. `/new` cancels the bound agent's turn, deletes the thread binding row (`ChannelStore.releaseThreadBinding`) and detaches the agent's stream, so the next message mints a fresh session through the ordinary first-mention path. The old agent stays in the app. `abandoned` is not used — that status permanently holds the key, which is the opposite of what `/new` asks for.
