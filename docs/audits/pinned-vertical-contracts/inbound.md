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
