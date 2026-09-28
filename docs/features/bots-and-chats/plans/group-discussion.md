# Group discussion

Date: 2026-09-28. Status: decided, not implemented. Revises the defaults of README
[D9](../README.md#d9-group-turn-rules-follow-the-channel-route-model) and the "who answers" table in
[server-chat §2.2](server-chat.md#22-who-answers-turn-rulests-pure). Scope: bots in one Chat on one
Host. Channels (Slack, Telegram) come later and reuse the same rules through the Hub.

## Problem

Several bots in a group chat do not discuss. A message without a mention reaches every bot in
parallel, each answers the user without seeing the others, and the chat stops. A bot can only pass
the word by writing another bot's `@slug`, but nothing tells it who is in the room or what their
slugs are. When it does mention someone, the target is forced to answer, so two bots that tag each
other politely ping-pong until the hop limit. The composer cannot tag a bot or the whole room.

## Reference: Grok Bot group chats

The behavior users compare against ([docs](https://docs.x.ai/grok-bot/chat-and-collaboration);
internals reconstructed in [this gist](https://gist.github.com/kzu/fc624ee4e9d93b3715bd795d40b8c4a7),
not official):

- The host owns the room. Each bot keeps its own transcript and is woken with the room name, the
  other members, the messages since its last turn, and "It's your turn".
- Bots speak one at a time in Members order; the next bot sees what the previous one said.
  `@everyone` and an unaddressed message both wake the whole room.
- A mention is an invitation to speak. Staying silent is a valid turn; a bot tagged only in an
  acknowledgement does not answer.
- The host stops ping-pong with a "room is wrapping up" cue and a cap, not by reading content.
- A new user message takes priority over the discussion; "Stop now" ends work.

## Options considered

| Option                                | Why not alone                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| Prompt only (roster + silence)        | Bots learn to tag each other, but unaddressed messages still answer in parallel |
| Mention handoff only (Swarm style)    | Good for delegation, cannot express "everyone weigh in"                         |
| Moderator LLM picks the next speaker  | An extra model call per turn; not needed while groups are two to six bots       |
| Ask every bot "do you want to speak?" | Every bot is a full agent turn; costs N turns to pick one speaker               |
| **Room contract + turns in rounds**   | Chosen: the Grok behavior, with state the engine already keeps                  |

## Decision

### Room contract in the system prompt

Each (bot, chat) session starts with a system prompt built by a pure function in
`packages/server/src/server/chats/`, passed as `config.systemPrompt` when `bot-sessions.ts` creates
the session and rebuilt when the session resumes. It has two parts:

1. **Fixed frame**, in code, not stored, not editable. It states the bot's display name, slug and
   description; every member as `@slug — display name — description`; and how the room works:
   - a mention or `@everyone` is an invitation to speak, not an obligation;
   - speak only to answer a question aimed at you, add new information, disagree, or take a step you
     own; otherwise reply exactly `PASS`;
   - even when the user tagged only you, decide whether another member's role covers part of the
     request, and tag them with one concrete ask each;
   - never tag for thanks, agreement or a passing reference; never write `@everyone`;
   - keep it short and in the user's language; stop early when the question is settled.
2. **Room instructions**: one text field the chat owner edits in Group settings, appended after the
   frame inside a delimited block with the rule that the frame wins on conflict. Empty means the
   built-in default text. There is one default for now; named presets wait until real use shows
   which ones earn a place.

The frame is not editable because the engine reads its output: `PASS` means silence and `@slug`
decides who wakes. The channel plane learned this when a Route's `outbound.template` replaced the
whole block and Codex answered into silence ([codex-channel](../../channels/codex-channel.md)).
Group settings shows the full rendered prompt read-only.

A bot with no description is listed with its display name only. Bot settings and Add Member remind
the owner that other bots use the description to decide when to tag this one.

Membership or room-instruction changes do not reset sessions. The next wake of each bot starts with
a `[Room update]` line saying what changed, and a resumed session gets a freshly built prompt.

### Silence is a valid turn

A turn whose final text is empty or exactly `PASS` appends nothing to the transcript. The
"finished without a reply" notice is removed. Failures still end in a `system` line: silence is
the bot's choice, a failed delivery is not.

### Turns in rounds

One bot speaks at a time per Chat. Bots in different Chats still run concurrently, so D8 stands.

- **Start**: a user line opens a discussion. Its queue is the mentioned bots, or every member when
  the line mentions nobody or uses `@everyone` (aliases `@all`, `@here`), in Members order. With
  `requireMention: true` an unaddressed line wakes nobody, as today.
- **Turn**: the engine wakes the next bot with everything since its watermark (`deliveredSeq`,
  already kept per participant). The bot answers or passes.
- **Next round**: when the queue empties, the next round queues every member with unseen lines that
  are not its own, bots mentioned since their last turn first, then Members order.
- **End**: a round in which nobody speaks ends the discussion. `rounds.max` (default 5) is a guard
  rail, not a target: bots are told to stop as soon as the question is settled, and the last round's
  wake says the room is wrapping up. Reaching the cap appends a `system` line.
- **Preempt**: a new user line cancels the queue and opens a new discussion; a running turn is
  steered through the existing `whenBusy: steer`.
- **Stop all**: a Chat action that cancels the queue and interrupts the running turn.

`rounds.max` replaces `hops.max`. Stored `hops` stays readable and is ignored, tagged `COMPAT`.

Sequential turns are slower than parallel ones (about N turn times per round). That is accepted:
each bot answering with the others' words in view is the point.

### Tagging from the app

- Typing `@` in the chat composer lists **Everyone**, then Members (avatar, display name), then the
  existing file suggestions. Picking a member inserts `@slug`; slugs never change (D3), so a stored
  mention never breaks on rename.
- `@everyone` is a reserved token; a bot slug may not take it or its aliases.
- User and bot lines render `@slug` of a participant, and `@everyone`, as a chip. Unknown `@x` stays
  text.
- For bot lines only, the server also matches a participant's display name after `@`, because
  models write names they read in the roster.

### Wire and flag

One capability flag, `server_info.features.bots` (README D10). Protocol additions are optional
fields: `rules.room.instructions`, `rules.rounds.max`, their `chat.update` patch keys, and a
`chat.discussion.stop` request.

## Order of work

1. Room contract, silence, `[Room update]`: server only, `chats/` and `bot-sessions.ts`.
2. Turns in rounds, preempt, Stop all: `turn-rules.ts`, `chat-engine.ts`, one app action.
3. Room instructions in Group settings.
4. Composer `@` picker and mention chips (app; can run beside 1–3).

## Later

- Channels: the same rules through the Hub, which needs a sender-is-bot fact, a peer-bot list,
  broadcast mention recognition, and in-process forwarding between bots it hosts, because Telegram
  does not deliver bot messages to other bots.
- An asynchronous bot-to-bot handoff tool (Grok's `SendToAgent`) and a member lookup tool.
- Named room presets and saving a group's instructions as one.
