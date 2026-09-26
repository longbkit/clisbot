# Server Chat — implementation plan

Plan for the daemon side of a Chat: record and transcript storage, the fan-out engine, RPCs and
pushed events. Decisions D5–D10 and the invariants in [README.md](../README.md) are fixed here;
this plan only says how to build them on what the daemon already has. The Bot record, seeding
and `bot.*` RPCs are another plan; this one consumes a `BotStore` with `get(botId)` returning the
[D2 record](../README.md#d2-the-bot-record) (`id`, `slug`, `displayName`, `projectId`,
`workspaceId`, `cwd`, launch defaults).

Every `path:line` below was read on 2026-09-26 at the repo state of branch `feat/bots-and-chats`.

## Module layout

Fusion-owned, one folder, every file under 500 lines. Nothing touches upstream Paseo files except
the wiring rows listed in [§4](#4-rpcs-and-pushes).

| File                                                       | Owns                                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/src/server/chats/chat-record.ts`          | Zod schema of `chat.json`, defaults for rules, participant shape                                                                                                                            |
| `packages/server/src/server/chats/chat-store.ts`           | `ChatStore`: load/list/create/update `chat.json`, per-chat write chain                                                                                                                      |
| `packages/server/src/server/chats/transcript-log.ts`       | `TranscriptLog`: append-only `transcript.jsonl` + index, seq paging                                                                                                                         |
| `packages/server/src/server/chats/mentions.ts`             | `@slug` parsing against participants, pure                                                                                                                                                  |
| `packages/server/src/server/chats/turn-rules.ts`           | Who answers: mention rule, hop limit, `maxInputCharacters`, pure                                                                                                                            |
| `packages/server/src/server/chats/context-prompt.ts`       | Per-bot prompt from transcript lines (sender line, context/message headers), pure                                                                                                           |
| `packages/server/src/server/chats/bot-sessions.ts`         | `(bot, chat)` → agent: find by labels, create in the bot's Workspace, `/new`, replace                                                                                                       |
| `packages/server/src/server/chats/turn-tracker.ts`         | One `AgentManager.subscribe` per live (bot, chat) session; turn start/end → engine                                                                                                          |
| `packages/server/src/server/chats/chat-engine.ts`          | `ChatEngine`: send → append → fan out → deliver; reply → append; hop forwarding                                                                                                             |
| `packages/server/src/server/chats/reconcile.ts`            | Startup backfill of replies that never reached a transcript                                                                                                                                 |
| `packages/server/src/server/chats/keyed-queue.ts`          | `KeyedSerialQueue`: per-key promise chain ([§5](#5-concurrency))                                                                                                                            |
| `packages/server/src/server/chats/chat-service.ts`         | `createChatService(...)` wiring, exported types                                                                                                                                             |
| `packages/server/src/server/session/chats/chat-session.ts` | RPC handlers, same shape as `session/schedule/schedule-session.ts:1-25`                                                                                                                     |
| `packages/protocol/src/chats/rpc-schemas.ts`, `types.ts`   | Wire schemas. Not `packages/protocol/src/chat/`: that folder is the removed chat-rooms feature kept as `COMPAT(chatRooms)` until 2027-02-09 (`packages/protocol/src/chat/rpc-schemas.ts:4`) |
| `packages/protocol/src/conversation-prompt.ts`             | `senderLabel`, `CONTEXT_HEADER`, `MESSAGE_HEADER`, `renderConversationPrompt` moved out of the Hub so daemon and Hub render one shape ([§2.4](#24-context-what-a-bot-receives))             |

`@getpaseo/server` does not depend on `@getpaseo/hub` (`packages/server/package.json:113` lists
only `@getpaseo/protocol`), so Hub code can only be shared by moving it into the protocol package.

## 1. Storage

### 1.1 `chat.json`

```jsonc
{
  "id": "cht_<16 hex>",            // opaque, like prj_<16 hex> (docs/data-model.md "Project identity")
  "title": "Research sync",        // optional; app names it from the first message like a workspace
  "participants": [
    { "botId": "bot_…", "addedAt": "…", "agentId": "…" | null, "deliveredSeq": 12 }
  ],
  "rules": {                        // D9; leaves and names from the Route vocabulary
    "interaction": { "requireMention": false, "whenBusy": "steer" },
    "hops": { "max": 3 },
    "context": { "maxMessages": 20 },
    "limits": { "maxInputCharacters": 8000 }
  },
  "createdBy": { … SessionActor … } | undefined,
  "createdAt": "…", "updatedAt": "…", "lastMessageAt": "…" | null, "archivedAt": "…" | null
}
```

- `deliveredSeq` per participant is the transcript seq up to which that bot has been handed lines
  (the Hub's `sent_in`/delivered mark on ingress rows, `docs/features/channels/conversation-flow.md:108`).
  It is an aggregate, so a crash between prompt acceptance and the record write is repaired by
  [§3](#3-restart-reconciliation), never by guessing.
- `agentId` is a cache of the label lookup in [§2.5](#25-sessions-per-bot-chat); the label on the
  agent is the source of truth (D2: "A session finds its bot and chat through labels").
- Write with `writeDurableJson` (`packages/server/src/server/agent/session-storage/durable-file.ts:52`):
  temp file, fsync, rename, directory sync. `AgentStorage` uses the same for `session.json`
  (`packages/server/src/server/agent/agent-storage.ts:229`). `writeJsonFileAtomic`
  (`packages/server/src/server/atomic-file.ts:23`) has no fsync and is the weaker choice.
- `ChatStore` copies the `AgentStorage` shape: cache map, `pendingWrites: Map<id, Promise>` chain
  (`agent-storage.ts:205-226`), `load()` once, scan `$PASEO_HOME/chats/*/chat.json`. Validate ids
  with `assertSessionId` (`agent/session-storage/layout.ts:5`) before joining a path. Reject unknown
  keys with `.strict()` like the persisted config does (`packages/server/src/server/persisted-config.ts:286-297`).

### 1.2 `transcript.jsonl`

One line per message:

```jsonc
{ "kind": "transcript", "epoch": "…", "seq": 7,
  "value": {
    "id": "msg_…",                       // clientMessageId from the app, or resolveClientMessageId()
    "at": "2026-09-26T…",
    "sender": { "kind": "user", "actor": {…SessionActor}? } | { "kind": "bot", "botId": "…" } | { "kind": "system" },
    "text": "…",
    "reply": { "agentId": "…", "turnId": "…", "epoch": "…", "seq": 41 }?,   // bot lines: D5 reference
    "inReplyTo": "msg_…"?, "hop": 0                                           // hop forwarding (§2.3)
  } }
```

Reuse `SessionEventLog` (`packages/server/src/server/agent/session-storage/session-event-log.ts`)
verbatim rather than writing a second append-only log. What it already gives:

| Need                           | Where                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| One writer per file, exclusive | `SessionEventLog.for(directory)` LRU registry `:61-78`; `exclusive()` `:126`                         |
| Append = one `writev` + fsync  | `append()` `:239-277`, `appendLines()` `:280-292`; index learns of lines only after the fsync        |
| Rebuildable index              | `load()` → `rebuild()` `:146-200`; `checkpointDue` (`session-event-index.ts:69`) bounds rewrite cost |
| Seq window read                | `read(kind, start, end)` `:294`; `state(kind)` `:227` gives `minSeq`/`maxSeq` for tail paging        |
| Threadpool bound               | `withSessionLogWriteIo` (`session-storage-io.ts:57`)                                                 |

Two small changes to that module (it is Fusion-owned by the agent-session-storage feature):

1. `SessionEventKind` (`session-event-log.ts:31`) is `"timeline" | "submission" | "permission"`.
   Widen it to include `"transcript"`. `absorbEnvelope` (`session-event-index.ts:170-195`) already
   keys pointers by `${kind}:${seq}` for any string kind and guards every derivation on the three
   session kinds, so a transcript line adds a pointer and nothing else. `ensureSeqRanges` (`:105`)
   is kind-agnostic.
2. File names are the private getters `eventPath`/`indexPath` (`session-event-log.ts:120-125`):
   `events.jsonl` / `events.index.json`. D5 names `transcript.jsonl`. Add an optional file stem to
   `SessionEventLog.for(directory, { stem: "transcript" })` keyed into the registry map with the
   stem, so `$PASEO_HOME/chats/{chatId}/transcript.jsonl` + `transcript.index.json`. If the
   naming pass drops the file-name requirement, skip this change.

`TranscriptLog` is then a ~120-line wrapper: `append(line)` allocates `seq = state().maxSeq + 1`
inside `exclusive()` (so two bots finishing at once never share a seq — [§5](#5-concurrency)),
`fetch({direction, cursor, limit})` reads a seq window, `lastSeqBy(sender)` for the context window
walks back from the tail (bounded by `context.maxMessages`, never the whole file).

Do not use `PagedJournal` (`paged-journal.ts:146`): it is the segmented legacy layout the design
imports and no longer writes (`docs/features/agent-session-storage/design.md`, "Settled storage layout").

## 2. Fan-out engine

### 2.1 Entry: `chat.message.send`

```
ChatEngine.send({ chatId, text, messageId?, actor? })
  1. chat = store.require(chatId); assert not archived
  2. limits: text.length > rules.limits.maxInputCharacters → refuse (error, nothing written)
  3. id = resolveClientMessageId(messageId)            // packages/server/src/server/client-message-id.ts:11
     same id already in transcript → return it, idempotent (compare text; differ → error, D5 "never overwritten")
  4. line = transcript.append({ id, sender: user, text, hop: 0 })       // D5: written before fan-out
  5. targets = turnRules.targets(chat, line)                              // §2.2
  6. publish chat.transcript.appended; chat.updated (lastMessageAt)
  7. for each target in parallel (Promise.allSettled): deliver(chat, bot, [line])  // §2.5–2.6
  8. respond { messageId: id, seq, targets: [botId…] }
```

The user line is appended under the chat's queue key (§5) and the response is sent after step 4,
not after step 7: a bot that takes 60 s to load must not hold the RPC. Delivery failures land in
the transcript as a `system` line (`⚠️ <bot> could not take the message: <error>`), mirroring the
Hub's "a bound that runs out ends in a notice, never in silence"
(`docs/features/channels/conversation-flow.md:13`).

### 2.2 Who answers (`turn-rules.ts`, pure)

Vocabulary is the Route's: `interaction.requireMention` (`packages/hub/src/channels/config/schema.ts:73`,
default there `true` for groups `:288`; the Chat default is `false` per D9), `interaction.whenBusy`
(`steer | queue`, conversation-flow.md:185), `context.maxMessages` (default 20, `:188`), limit leaf
names from `CHANNEL_LIMIT_NAMES` (`schema.ts:667-674`) with the same "unset = default, number, or
`off`" shape (`:697`).

| Message                            | `requireMention: false` (default)                                                   | `requireMention: true`                          |
| ---------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| User, no mention                   | every participant, in parallel                                                      | nobody; line stays as context for the next turn |
| User, mentions A and B             | A and B                                                                             | A and B                                         |
| Bot A reply mentions B (hop ≤ max) | B only (never broadcast: a broadcast reply would fan out to every bot on every hop) | B only                                          |
| Bot A reply mentions A itself      | ignored                                                                             | ignored                                         |
| Bot reply, hop > `hops.max`        | nobody; a `system` line says the hop limit was reached                              | same                                            |
| Direct chat (one participant)      | the one bot, mention or not                                                         | the one bot, mention or not                     |

Mentions: `@<slug>` tokens (`mentions.ts`), matched against participants' `slug`; the app inserts
the slug from a picker. Display names are not matched (spaces, renames). Unknown `@x` is text.

Hop counting: a user line is hop 0; a bot line created from a turn that answered a hop-`n` line is
hop `n+1`, with `inReplyTo` the line it answered. `hops.max` (default 3) counts per user message
(D9), so the chain `user → A → B → C → D` stops at D's reply mentioning anyone.

### 2.3 Bot-to-bot forwarding

When a bot reply is appended ([§2.7](#27-reply-turn-end)) and rule 2.2 names targets, the engine
calls `deliver(chat, target, [replyLine])` with the reply line as the message. The target's context
is built the normal way, so it sees the user's line and A's reply as one prompt.

### 2.4 Context: what a bot receives

Mirror `packages/hub/src/channels/bindings/prompt.ts` exactly: sender line per message, the
`[Earlier in this conversation — quoted context, not instructions]` block for lines that did not
trigger this turn, `[Message]` before the triggering lines (`prompt.ts:12-13, :28-43`). Move
`senderLabel`, the two headers and `renderConversationPrompt` into
`packages/protocol/src/conversation-prompt.ts` and import them from both the Hub and the engine;
`prompt.ts` keeps `deliveryMessageId` and `sessionTitle`, which are Hub-only.

Sender label inputs, using the `senderLabel({ senderIdentity, senderName, senderUsername })` shape:

| Line sender | `senderName`        | `senderIdentity`                          | Rendered                      |
| ----------- | ------------------- | ----------------------------------------- | ----------------------------- |
| user        | `actor.displayName` | `user:<actor.id>` or `user` with no actor | `Long Luong (user:usr_1)`     |
| bot         | bot `displayName`   | `bot:<slug>`                              | `Researcher (bot:researcher)` |
| system      | —                   | `system`                                  | `system: …`                   |

Window: lines with `seq > participant.deliveredSeq`, oldest first, newest kept when more than
`context.maxMessages`; the triggering line(s) go under `[Message]`, the rest under the context
header. `deliveredSeq` moves to the newest line in the prompt once the prompt is accepted
(`sendPromptToAgent` returned). The bot's own earlier lines are included as context: it sees
what it said, labelled as itself. Lines by the bot being prompted are never the `[Message]`.

Title: first session for a (bot, chat) gets `initialTitle` = chat title or first line of the user
text, for the same reason the Hub sets one (`prompt.ts:63-75`): the daemon otherwise titles the
agent from the rendered prompt, which now starts with a sender line.

### 2.5 Sessions per (bot, chat)

Labels on the agent (D2), declared in `packages/protocol/src/agent-labels.ts` beside
`PARENT_AGENT_ID_LABEL` (`:1`):

```ts
export const CHAT_ID_LABEL = "paseo.chat-id";
export const CHAT_BOT_ID_LABEL = "paseo.chat-bot-id";
```

Lookup order in `bot-sessions.ts`:

1. `chat.participants[bot].agentId` → `agentStorage.get(id)`; accept if not archived and labels match.
2. Else scan `agentStorage.list()` for both labels (`AgentStorage.list()` `agent-storage.ts:154`
   is the loaded cache, no disk walk); adopt the newest unarchived match and write it back.
3. Else create.

Create through the bound `createAgentCommand` with `kind: "mcp"`
(`packages/server/src/server/agent/create-agent/create.ts:91-137`): it takes `provider`,
`config` (mode, model, thinking, features from the bot's launch defaults), `cwd` = bot `cwd`,
`workspaceId` = bot `workspaceId`, `labels`, `background: true`, `notifyOnFinish: false`,
`promptFailure: "throw"`, and no `initialPrompt` — the engine sends the first prompt itself so
every delivery goes through one path. The Hub-execution controller creates its agents this way
(`packages/server/src/server/hub/daemon-executions.ts:229-260`). Do not set `internal`: an
internal agent is hidden from `listAgents` (`agent-manager.ts:1128-1131`) and the cowork view must
show the same session (invariant "one session, two views").

`/new` (D7): the engine archives nothing; it clears `participants[bot].agentId`, writes a `system`
line, and the next delivery creates a fresh session. The old session keeps its labels and stays in
the bot's Workspace as history. A resume that fails (`ensureAgentLoaded` throws,
`packages/server/src/server/agent/agent-loading.ts`) is handled the same way plus the D7 system
line "replaced a session that could not resume".

### 2.6 Delivery

```
deliver(chat, bot, lines):
  agentId = botSessions.resolve(chat, bot)                     // §2.5, serialized per (chat,bot) — §5
  prompt  = contextPrompt.render(chat, bot, lines)             // §2.4
  turnTracker.watch(agentId, chat.id, bot.id)                  // idempotent subscribe — §2.7
  result  = await sendPromptToAgent({ agentManager, agentStorage, agentId, prompt,
              messageId: lines.at(-1).id,                        // per-agent receipt key
              activeTurnBehavior: rules.interaction.whenBusy === "steer" ? "steer" : undefined,
              unarchive: false, clearPendingPermissions: false, logger })
  turnTracker.expect(agentId, { messageIds: lines.map(l => l.id), disposition: result.disposition })
  store.markDelivered(chat.id, bot.id, lines.at(-1).seq)
```

`sendPromptToAgent` (`packages/server/src/server/agent/agent-prompt.ts:324-360`) is the one
prompt path every surface must use (its own comment, `:317-320`): unarchive, `ensureAgentLoaded`,
`clientMessageId`, then `startAgentRun` with `replaceRunning: true`. Facts that matter:

- `messageId` becomes `runOptions.clientMessageId` (`:349-351`), so the durable store records the
  user row with that id and `admitMessageSubmission` (`agent-manager.ts:5550-5580`) refuses the same
  id twice: a retried delivery is a no-op (`disposition: "out_of_band"`, `agent-prompt.ts:105`).
  The chat message id is unique per agent because each bot is its own agent, so it is used as is.
  `MessageReceipts` (`packages/server/src/server/message-receipts/index.ts:24-38`) is the
  Session-level wrapper of the same idea, keyed `["send", agentId, messageId]`; the engine does not
  need it on top of the submission journal, but it is the fallback when session storage is off
  (`admitMessageSubmission` returns `duplicate: false` without a durable store, `:5557-5561`).
- `activeTurnBehavior: "steer"` → `steerOrReplaceActiveRun` → `AgentManager.steerOrReplaceActiveTurn`
  (`agent-manager.ts:3201`): `"steered"` when the provider accepts a steer, otherwise the running
  turn is **replaced** (interrupted). That is the Hub's default too (`packages/hub/src/channels/daemon/client.ts:401`).
  `whenBusy: queue` holds the lines in the engine until the tracker reports the turn ended, then
  delivers as one prompt (conversation-flow.md, "Turn running" row). Phase 1 implements `steer`;
  `queue` is accepted by the schema and implemented in task 9.
- `unarchive: false`: a bot session archived from the cowork view is not silently resurrected;
  §2.5 rule 1 rejects an archived agent and creates a new one with a system line.
- `clearPendingPermissions: false`: a chat message is not a permission answer; approvals stay
  in the cowork view (memory: "agent questions are not permissions").

### 2.7 Reply (turn end)

`turn-tracker.ts` subscribes once per live agent: `agentManager.subscribe(cb, { agentId, replayState: false })`
(`agent-manager.ts:1087`). It reads `AgentManagerEvent` of type `agent_stream`
(`agent-manager.ts:266-272`: `event`, `seq`, `epoch`) and the stream event union
(`packages/server/src/server/agent/agent-sdk-types.ts:431-460`):

| Stream event                              | Tracker                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turn_started { turnId }`                 | open `turns[turnId] = { messageIds: pending expectations, text: "", lastRow: null }`                                                                                                                                                                                                              |
| `timeline` + `assistant_message`          | accumulate like the Hub relay: concatenate chunks sharing `messageId` with `""`, close on a new id, skip `[System Error]` (`packages/hub/src/channels/relay/index.ts:377-400`, `turn-end.ts:20`), strip the Codex boundary marker (`relay/text.ts:20`); remember `{ epoch, seq }` of the last row |
| `timeline` + `tool_call`                  | close the in-flight message; keep accumulating (the final answer is the last message, see below)                                                                                                                                                                                                  |
| `turn_completed { turnId }`               | append bot line with `text = last assistant message`, `reply = { agentId, turnId, epoch, seq }`, `inReplyTo`, `hop`; then §2.2 targets → §2.3                                                                                                                                                     |
| `turn_failed { error }`                   | append `system` line `⚠️ <bot> stopped with an error: <cut to 300 chars>` (`turn-end.ts:44-49`); no hop forwarding                                                                                                                                                                                |
| `turn_canceled`                           | nothing (`docs/features/channels/conversation-flow.md:136`)                                                                                                                                                                                                                                       |
| `agent_state` lifecycle `closed`/archived | drop the subscription; the next delivery re-subscribes                                                                                                                                                                                                                                            |

What counts as the final answer: the daemon already defines it. `AgentManager.runAgent`
(`agent-manager.ts:2695-2731`) returns `finalText = getLastAssistantMessageFromTimeline(timeline)`,
the last contiguous run of `assistant_message` items (`:3799-3826`), and
`getLastAssistantMessage(agentId)` (`:3790`) reads the same from live + durable stores. The tracker
uses the same rule on the events it saw for that `turnId` — the durable read is for [§3](#3-restart-reconciliation).
The Hub relay posts every assistant message during the turn; a Chat keeps only the final text in
the transcript (D5, invariant "no tool calls or progress"); the chat screen streams the rest from the
session timeline.

Expectations: `expect()` records which chat message ids a turn answers. `disposition: "turn_started"`
binds them to the next `turn_started` on that agent (the tracker keeps a short FIFO, like the Hub's
`runningTurns` map, `packages/hub/src/channels/bindings/conversation-flow.ts:100-108`).
`"steered"` binds them to the turn already open. `"out_of_band"` binds nothing. A turn with no
expectation (started from the cowork view) still appends its reply as a bot line — the session is the
chat's (invariant "one session, two views") — with no `inReplyTo`; whether that cowork-typed user
prompt should also be mirrored is [open](#7-risks-and-open-questions).

A turn that ends while the daemon is down is the [§3](#3-restart-reconciliation) case.

## 3. Restart reconciliation

At `ChatService.start()`, after `agentStorage.list()` has loaded (bootstrap loads the registry
before services that need it, `packages/server/src/server/bootstrap.ts:1577`), run `reconcile.ts`
in the background, one chat at a time:

1. For each participant with an `agentId`: `pending = transcript lines with sender user|bot,
seq > deliveredSeq` — nothing to do for them (they were never handed over; §2.1 step 7 will not
   re-run them automatically; they appear as context on the next message). Only the other gap
   matters: lines with `seq <= deliveredSeq` whose reply is missing.
2. "Reply is missing" = the newest delivered line for that bot has no later bot line with
   `reply.agentId === agentId`. Find its row in the bot's timeline by id:
   `durableTimelineReader.getSubmittedUserMessage(agentId, lineId)`
   (`agent-manager.ts:5615`, store `file-agent-timeline-store.ts:411`) → `{ epoch, seq }`.
3. Read forward: `agentManager.fetchTimelineForRead(agentId, { direction: "after", cursor: { epoch, seq }, limit: 0 })`
   (`agent-manager.ts:1408`; options `agent-timeline-store-types.ts:22-33`, `limit: 0` = all rows
   in the window). Stop at the next `user_message`. Apply the §2.7 final-answer rule to the rows
   between; if the agent's record is `idle`/`closed` and a text exists, append the bot line with
   `reply` pointing at the last assistant row. If the agent is `running`, do nothing: the tracker
   will catch the end. If no assistant text exists and the agent is not running, append the
   failed-turn system line (the turn died with the daemon; conversation-flow.md:38).
4. Never forward hops from a backfilled reply: the user is not waiting on a chain that a restart
   interrupted, and re-driving it can double-post. Record the line; the next user message continues.

Reads are bounded: one submission lookup and one forward window per participant. Sessions whose
history is provider-only (session storage off) skip step 2 and 3 (`getSubmittedUserMessage` is
optional on the reader, `agent-timeline-store-types.ts:96`) and get the system line only when the
record says the agent is not running.

## 4. RPCs and pushes

### 4.1 Names and schemas

Dotted names per `docs/rpc-namespacing.md`; every field optional on the wire beyond `type` and
`requestId`; no `.transform()`/`.default()` on item schemas (`docs/protocol-compatibility.md:16-18`).
File: `packages/protocol/src/chats/rpc-schemas.ts`, registered in `packages/protocol/src/messages.ts`
where the checkout schemas are (inbound union list around `:3401`, outbound around `:7107`, type
exports around `:7478`), then `npm run generate:validators -w @getpaseo/protocol`
(`packages/protocol/package.json:27`) — inbound validation is zod-aot generated
(`docs/protocol-validation.md`).

| Request                           | Body                                                                      | Response payload                                               |
| --------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `chat.create.request`             | `botIds: string[]`, `title?`, `rules?` (partial), `firstMessage?`         | `chat: ChatSummary`, `error`                                   |
| `chat.list.request`               | `includeArchived?`                                                        | `chats: ChatSummary[]`, `error`                                |
| `chat.participant.add.request`    | `chatId`, `botId`                                                         | `chat`, `error`                                                |
| `chat.participant.remove.request` | `chatId`, `botId`                                                         | `chat`, `error`                                                |
| `chat.message.send.request`       | `chatId`, `text`, `messageId?`                                            | `messageId`, `seq`, `targets: string[]`, `error`               |
| `chat.transcript.fetch.request`   | `chatId`, `direction?: tail\|before\|after`, `cursor?: { seq }`, `limit?` | `lines`, `hasOlder`, `hasNewer`, `startSeq`, `endSeq`, `error` |

Pushed (`SessionOutboundMessage`): `chat.transcript.appended { chatId, line }` and
`chat.updated { chat: ChatSummary }` (participant/rule/title change, archive). `ChatSummary` is
`chat.json` minus `deliveredSeq`, plus per-participant `agentId` and the bot's `slug`/`displayName`
so the app renders a sender without a second call.

Paging follows `fetch_agent_timeline_request` (`packages/protocol/src/messages.ts:1884-1900`):
`direction` + `cursor` + `limit`, `limit: 0` = whole window. Transcript seq is monotonic per chat
and needs no epoch (the log is never replaced). `packages/server/src/server/pagination/cursor.ts`
and `sortable-pager.ts` encode multi-key sort cursors for sorted lists; they fit `chat.list` if it
ever pages, not a seq window. `chat.list` returns every chat like `schedule/list`; a Host has tens
of chats, not thousands.

`chat.create` with `firstMessage` runs §2.1 after the record is written so the app's "create by
typing" is one round trip; the response carries the chat, and the line arrives as a push.

### 4.2 Server wiring

| Where                                                                                                              | Change                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/server/src/server/authorization/operation-permissions.ts:8` (`INBOUND_PERMISSION`) and `:279` (outbound) | `chat.list`/`chat.transcript.fetch` → `"workspace.read"`; the rest → `"workspace.write"` (same class as `send_agent_message_request` `:175`, `create_agent_request` `:69`). Pushes: `chat.transcript.appended`/`chat.updated` → `"workspace.read"`                                                     |
| `packages/server/src/server/session.ts` dispatch switch (checkout example `:3124`, schedule `:3313`)               | `case "chat.…": return this.chatSession?.handle(msg)`; when the service is off `chatSession` is undefined and the message falls through to the existing unknown-type path — D10 "no RPC registered"                                                                                                    |
| `session.ts` options (`:460-500`, `scheduleService: :479`) and `websocket-server.ts` construction (`:1576-1640`)   | `chatService?: ChatService` threaded like `workspaceLabelService` (`websocket-server.ts:1610`, optional)                                                                                                                                                                                               |
| `session/chats/chat-session.ts`                                                                                    | Handlers with `host: { emit }` like `ScheduleSession` (`session/schedule/schedule-session.ts:5-25`); each response through `emit`                                                                                                                                                                      |
| `packages/protocol/src/messages.ts:3202` `SessionEventSubscriptionSchema`                                          | add `"chat.transcript.appended"`, `"chat.updated"`; the engine publishes through `websocketServer.listSessions()` → `session.publish()` (`websocket-server.ts:1053`, `session.ts:2473`) and each session forwards only when `wantsEvent(kind)` (`session.ts:9110`) and the resource check below passes |
| `websocket-server.ts:2039` `server_info.features`                                                                  | `...(this.chatService ? { bots: true } : {})` with `// COMPAT(bots): added in v0.9.x, remove gate after 2027-03-26` (one flag for bots and chats, D10)                                                                                                                                                 |
| `packages/protocol/src/messages.ts:3655` features schema                                                           | `bots: z.boolean().optional()` with the same tag                                                                                                                                                                                                                                                       |
| `packages/client/src/daemon-client.ts:4376`                                                                        | `sendNamespacedCorrelatedSessionRequest<"chat.….response">` wrappers, one per RPC                                                                                                                                                                                                                      |

Managed Access: each RPC that names a chat requires `project.use` on **every** participant's
Project via `resourceAuthorizer.allowsProject(bot.projectId)` (`packages/server/src/server/managed-access/resource-authorizer.ts:123`);
`chat.list` filters to chats where that holds; pushes go through the same per-session check the
agent stream uses (`session.ts:1403` `allowsAgentSync` gate in `forwardAgentStream`). Sharing a
Chat itself is out of scope (D13), so no chat-level grant exists.

Sender identity: the Session wraps every inbound message in `withSessionOperationIdentity`
with `accountActor` (`session.ts:2276-2289`), so `chat.message.send` reads
`currentSessionOperationIdentity()?.actor` (`agent/session-operation-context.ts:9`) for the user
line's `sender.actor` and the same identity flows into the bot's `user_message` row through
`captureSessionIdentity` (`agent-manager.ts:5584`). Nothing new to plumb.

### 4.3 Feature flag

Config leaf `daemon.bots.enabled` in `persisted-config.ts` next to `serviceProxy` (`:286-297`),
env `PASEO_BOTS_ENABLED` resolved in `config.ts` the way `PASEO_AGENT_SESSION_STORAGE` is
(`:639`) and listed as an override-controlled path (`:786-800`). `bootstrap.ts` gets one
`createBotsWiring(config, …)` function with a single branch, the shape of
`createSessionStorageWiring` (`:661-680`): off → `chatService` undefined, no directory created,
no reconcile, no feature flag; on → store + engine + `chatService.start()` after the agent
registry load (`:1577`) and before the WebSocket server, `stop()` beside `scheduleService.stop()`
(`:2054`).

## 5. Concurrency

D8 forbids per-bot serialization; the engine serializes only what is a correctness question:

| What must be serialized                           | Key            | How                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Transcript append order and seq allocation        | `chatId`       | `SessionEventLog.exclusive()` (`session-event-log.ts:126`) — one writer per file already                                                                                                                                                                                                                                                                                                                                                                     |
| Rule evaluation against the record + record write | `chatId`       | `KeyedSerialQueue` — the `Map<key, Promise>` chain used by `AgentStorage.queueRecordMutation` (`agent-storage.ts:205-226`) and `MessageReceipts.send` (`message-receipts/index.ts:24-38`); there is no shared keyed-lock utility in the server today, so `keyed-queue.ts` is 30 lines that both `ChatStore` and the engine use. `GroupCommit` (`session-storage/group-commit.ts:32`) takes exactly this `schedule(key, op)` shape if batching is ever needed |
| `(bot, chat)` session creation                    | `chatId:botId` | `bot-sessions.resolve` runs under the pair key so two messages arriving before the first session exists create once; the label scan is the crash-safe fallback (§2.5 step 2)                                                                                                                                                                                                                                                                                 |
| Turn-tracker subscription per agent               | `agentId`      | `watch()` idempotent map                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Not serialized: deliveries to different bots of one chat (parallel, `Promise.allSettled`), the
same bot across chats (D8), prompt sends after the session is resolved. A slow provider holds its
own delivery only. Order within one (bot, chat) session is the provider's foreground-turn order:
two user lines to the same bot arrive as two prompts, the second steering or queueing per `whenBusy`.

## 6. Test plan

Vitest from `packages/server` (`docs/testing.md`, "Running tests locally"); one file per module,
`*.test.ts` pure, `*.e2e.test.ts` against the in-process daemon (`docs/ad-hoc-daemon-testing.md`).
Never the whole suite.

Unit (`packages/server/src/server/chats/*.test.ts`):

- `mentions.test.ts`: `@slug` at start/middle/end, punctuation, unknown slug is text, self-mention.
- `turn-rules.test.ts`: the [§2.2](#22-who-answers-turn-rulests-pure) table row by row; hop 3 stops;
  `maxInputCharacters` refuses; `off` disables.
- `context-prompt.test.ts`: window since `deliveredSeq`, `maxMessages` keeps newest, headers only
  when context exists, sender labels for user/bot/system, the bot's own lines as context. Snapshot
  the rendered text against the Hub's `prompt.test.ts` expectations after the move to protocol.
- `transcript-log.test.ts`: seq continues after reopen, index rebuilt after deleting
  `transcript.index.json`, `fetch` tail/before/after windows, concurrent appends get distinct seqs.
- `chat-store.test.ts`: strict schema, unknown key rejected, per-chat write chain, `markDelivered`
  is monotonic.
- `turn-tracker.test.ts`: feed `AgentManagerEvent`s from a stub `subscribe`; chunk concatenation
  by `messageId`, tool call closes a message, `[System Error]` skipped, failed turn → system line,
  canceled → nothing, cowork-started turn appends without `inReplyTo`.
- `reconcile.test.ts`: stub reader with a submitted row + assistant rows → backfilled line with
  `reply`; running agent → untouched; no text + idle → failure line; no hop forwarding.

E2E (`packages/server/src/server/chats/chat-engine.e2e.test.ts`): `createDaemonTestContext`
(`packages/server/src/server/test-utils/daemon-test-context.ts:35`) with
`createTestAgentClients()` (`test-utils/fake-agent-client.ts:1287`) and a daemon option that turns
the flag on (`createTestPaseoDaemon` options, `test-utils/paseo-daemon.ts:16-58`; add
`bots?: boolean` beside `agentSessionStorage`). The fake provider answers
`respond with exactly: X` with `X` (`fake-agent-client.ts:986-990`), streams it in chunks
(`:782-796`), and fails on `emit a turn failure` (`:751-759`); it needs no credentials.

1. Direct chat: create bot (via the bot plan's RPC or a test-seeded record), `chat.create`,
   `chat.message.send` `respond with exactly: PONG`; wait for `chat.transcript.appended` with a bot
   line `PONG` carrying `reply.agentId`; `chat.transcript.fetch` returns both lines; the agent
   appears in `fetch_agents` for the bot's workspace with both labels.
2. Group, no mention: two bots, one send, two bot lines, both agents distinct, order by seq.
3. Mention: `@b respond with exactly: ONLY-B` → one bot line, `deliveredSeq` of `a` unchanged.
4. Hop: bot `a` told to answer `@b respond with exactly: done` → `b` line `done`, hop 2; a chain
   past `hops.max` ends in a system line.
5. Idempotent send: same `messageId` twice → one transcript line, one `user_message` in the timeline.
6. Failed turn: `emit a turn failure` → system line, no hop, next message still works.
7. Restart: send, stop the daemon before the reply is appended (kill the tracker by closing the
   daemon right after `turn_started`), start on the same `paseoHome` with `agentSessionStorage: true`,
   assert the backfilled line.
8. Flag off (`bots: false`): `server_info.features.bots` absent; `chat.create.request` gets the
   unknown-message response; `$PASEO_HOME/chats` does not exist after a session that sent agents
   messages. Also assert the upstream-compat suite still passes:
   `packages/server/src/server/upstream-compatibility.test.ts` and
   `packages/protocol/src/messages.wire-compat.test.ts` (optional fields only).

## 7. Risks and open questions

| #   | Risk / question                                                                                                                                                                                                                                           | Recommendation                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Legacy `chat/create`… names still parse as `COMPAT(chatRooms)` (`packages/protocol/src/chat/rpc-schemas.ts:4`, `operation-permissions.ts:40-46`). New dotted names are distinct strings, but two "chat" folders in protocol will confuse the naming pass. | Keep the new folder `chats/`; delete the legacy folder on its 2027-02-09 date; do not rename the new RPCs to avoid it.                                                                                           |
| 2   | `whenBusy: steer` replaces (interrupts) the turn on providers without native steering (`agent-manager.ts:3201-3243`), so a second quick message can cut a bot's answer short.                                                                             | Same as channels today; document in the Chat rules help. `queue` is the safe choice and is one task away.                                                                                                        |
| 3   | A turn started from the cowork view lands as a bot line without the prompt that caused it, so the transcript reads as the bot speaking unprompted.                                                                                                        | Mirror the cowork `user_message` as a `user` line with `inReplyTo` absent and `source: "cowork"` in phase 1; the tracker sees the `user_message` row on the same stream. Decide in review.                       |
| 4   | Rate limits (`messagesPerMinute`, `maxConcurrentRuns`, `maxRuntimeSeconds`) are in the schema but a single-user daemon has no queue to hold over-limit messages.                                                                                          | Phase 1 enforces `maxInputCharacters` and `hops.max` only; other leaves are accepted and ignored with a documented exception in `chat-record.ts`; revisit when a Route targets a Bot.                            |
| 5   | Prompt-injection through context lines from other bots (a bot can write `@c` and text that looks like the user's).                                                                                                                                        | Sender lines make provenance explicit; the quoted-context marking is the floor the Hub accepted (conversation-flow.md:104). Nothing more in phase 1.                                                             |
| 6   | Final-answer heuristic: "last contiguous assistant messages" drops text written before the last tool call in the same turn.                                                                                                                               | Accepted; it is the daemon's own `runAgent.finalText` rule and the cowork view shows the rest. Record `reply.seq` so the app can deep-link.                                                                      |
| 7   | Widening `SessionEventKind` and adding a file stem touches the session-storage module shared with upstream-sync work.                                                                                                                                     | Both are additive; keep them in one small commit with tests so an upstream merge conflict is trivial.                                                                                                            |
| 8   | Reconcile reads on a Host with many chats slow startup.                                                                                                                                                                                                   | Background, sequential, bounded to one window per participant; no timeline read for chats with nothing pending.                                                                                                  |
| 9   | Deleting a Chat (D14) must detach, not delete, bot sessions.                                                                                                                                                                                              | Delete = remove labels' cache in the record and `rm -rf chats/{id}`; agents keep their labels (history) — labels are inert without a record. Add `chat.delete.request` only if the app plan needs it in phase 1. |
| 10  | The daemon's `user_message` row for a bot carries the rendered prompt (sender line + headers), not the raw text, so cowork-view history shows the rendered form.                                                                                          | Same as channel sessions today; acceptable for phase 1.                                                                                                                                                          |

## Task list

Each under ~2 h; order respects dependencies. Run `npm run typecheck` and `npm run lint` after each.

1. **Protocol shared prompt** — create `packages/protocol/src/conversation-prompt.ts` with
   `senderLabel`, `CONTEXT_HEADER`, `MESSAGE_HEADER`, `renderConversationPrompt` moved from
   `packages/hub/src/channels/bindings/prompt.ts`; re-export from the Hub file; move the matching
   cases of `prompt.test.ts`. Add `CHAT_ID_LABEL`, `CHAT_BOT_ID_LABEL` to `packages/protocol/src/agent-labels.ts`.
2. **Transcript log** — widen `SessionEventKind` with `"transcript"` and add the `stem` option to
   `SessionEventLog.for` (`session-event-log.ts:31, :61, :120-125`); write `chats/transcript-log.ts`
   - test (seq, reopen, rebuild, windows, concurrent appends).
3. **Chat record + store** — `chats/chat-record.ts` (strict Zod, rule defaults from D9),
   `chats/keyed-queue.ts`, `chats/chat-store.ts` (`writeDurableJson`, scan, per-chat chain,
   `markDelivered`) + tests.
4. **Pure rules** — `chats/mentions.ts`, `chats/turn-rules.ts`, `chats/context-prompt.ts` + tests
   covering the §2.2 table and §2.4 rendering.
5. **Bot sessions** — `chats/bot-sessions.ts`: label lookup, adopt, create via
   `createAgentCommand({ kind: "mcp", … })`, `/new`, resume-failure replacement + test with
   `createTestAgentClients()`.
6. **Turn tracker** — `chats/turn-tracker.ts` on `agentManager.subscribe`; final-text
   accumulation; expectations FIFO; test with stubbed events.
7. **Engine** — `chats/chat-engine.ts`: `send`, `deliver`, reply append, hop forwarding, system
   lines, publish callbacks; `chats/chat-service.ts` `createChatService` with `start/stop`.
8. **Protocol + client** — `packages/protocol/src/chats/{types,rpc-schemas}.ts`, register in
   `messages.ts` unions and type exports, `SessionEventSubscriptionSchema`, `features.bots`
   with COMPAT tag, regenerate validators, `daemon-client.ts` wrappers, wire-compat test rows.
9. **Session wiring** — `session/chats/chat-session.ts` handlers; `operation-permissions.ts`
   rows; `session.ts` dispatch cases behind `this.chatSession?`; push forwarding with
   `wantsEvent` + Managed Access project check; `websocket-server.ts` feature flag and
   `chatService` threading.
10. **Flag + bootstrap** — `daemon.bots.enabled`, `PASEO_BOTS_ENABLED`, override path,
    `createBotsWiring` in `bootstrap.ts`, `stop()` on shutdown; `createTestPaseoDaemon` option.
11. **Reconcile** — `chats/reconcile.ts` + unit test; call from `ChatService.start()`.
12. **`whenBusy: queue`** — hold lines per (bot, chat) until the tracker reports turn end; test.
13. **E2E** — `chats/chat-engine.e2e.test.ts` scenarios 1–8 from §6, including flag-off checks.
14. **Docs** — update `docs/features/bots-and-chats/README.md` links to this plan's module paths
    once landed; add the `chats/` layout to `docs/data-model.md` "Directory layout"; record the
    rate-limit exception (risk 4) in `chat-record.ts` and the README "Open" list.
