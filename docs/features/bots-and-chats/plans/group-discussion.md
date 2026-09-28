# Group discussion

Date: 2026-09-28. Status: implemented on one Host (see [Implementation](#implementation)); not yet exercised against a live provider. Revises the defaults of README
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

Each (bot, chat) session in a group starts with a system prompt built by
`packages/server/src/server/chats/room-contract.ts`, passed as `config.systemPrompt` when
`bot-sessions.ts` creates the session. The daemon persists it with the agent, so a resumed session
keeps it. It has two parts:

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
The default text lives in `packages/protocol/src/chats/room.ts`, so the daemon's prompt and the
field's placeholder in Group settings are the same words.

A bot with no description is listed with its display name as its role. The bot form calls the
field **Role** and says other bots read it; Add bots and Participants show each bot's role, or
that it has none yet.

Membership, description or room-instruction changes do not reset sessions. Each participant stores
the fingerprint of the room it was last told (`roomSeen`); when it differs, the bot's next wake
starts with a `[Room update]` block restating the members and instructions. Sessions created before
the room contract existed have no fingerprint, so they get the block once on their next wake.

### Silence is a valid turn

In a group, a turn whose final text is empty or exactly `PASS` appends nothing to the transcript
and forwards nothing. Failures still end in a `system` line: silence is the bot's choice, a failed
delivery is not. A direct chat has no room contract, so a turn there without text still gets the
"finished without a reply" notice.

### Turns in rounds

One bot speaks at a time per Chat. Bots in different Chats still run concurrently, so D8 stands.

- **Start**: a user line opens a discussion. Naming bots opens an _addressed_ discussion whose queue
  is those bots. `@everyone` (aliases `@all`, `@here`) or no mention opens an _open_ discussion
  whose queue is every member in Members order. With `requireMention: true` an unaddressed line
  wakes nobody, as before.
- **Turn**: the engine wakes the next bot with everything since its watermark (`deliveredSeq`,
  already kept per participant). The bot answers or passes.
- **Next round**: when the queue empties, the next round queues members with unseen lines from
  others, bots named since their last turn first, then Members order. An open discussion takes every
  such member; an addressed one only the named ones, so tagging one bot does not pull the rest of
  the room in unless that bot tags them.
- **End**: a round in which nobody speaks ends the discussion. `rounds.max` (default 5) is a guard
  rail, not a target: bots are told to stop as soon as the question is settled, and the last round's
  wake says the room is wrapping up. Reaching the cap appends a `system` line.
- **Preempt**: a new user line cancels the queue and opens a new discussion; a running turn is
  steered through the existing `whenBusy: steer`.
- **Stop all**: a header action shown while a group bot is working. `chat.discussion.stop` ends the
  discussion, interrupts every running participant and appends `⏹ Stopped by the user.`. Stopping
  one bot from its own session also ends the discussion: the user took the floor. A cancel that a
  steer caused is not a stop, because a prompt is still waiting for that bot.

The discussion is held in memory (`packages/server/src/server/chats/discussion.ts`). A daemon
restart ends it; startup backfill still recovers the reply of a turn that finished while the daemon
was down. Because a discussion wake hands a bot every unseen line, its reply may answer a later line
than the newest one addressed to it; backfill counts that reply as answering the earlier one.

`rounds.max` replaces `hops.max`. Stored `hops` stays readable and is ignored, tagged `COMPAT`.

Sequential turns are slower than parallel ones (about N turn times per round). That is accepted:
each bot answering with the others' words in view is the point.

### Tagging from the app

- Typing `@` in a group composer lists **@everyone**, then Members by display name, then the
  existing file suggestions. Picking a member inserts `@slug`; slugs never change (D3), so a stored
  mention never breaks on rename. The grammar is `packages/protocol/src/chats/mentions.ts`, shared
  by the picker, the transcript and the daemon.
- `@everyone` and its aliases are reserved: a new bot named Everyone gets the slug `everyone-2`.
- Transcript lines show a participant's `@slug` as `@Display Name`, bold in bot lines, and the
  room-wide token as `@everyone`. Unknown `@x` stays as written.
- For bot lines only, the server also matches a participant's display name after `@`, because
  models write names they read in the roster.

### Wire and flag

One capability flag, `server_info.features.bots` (README D10). Protocol additions are optional
fields: `rules.room.instructions` and `rules.rounds.max`, the `roomInstructions` and `roundsMax`
keys of the `chat.update` patch, and the `chat.discussion.stop` request. Group settings edits both
(**Discussion limit**, 1 to 20 rounds). Creating a group keeps the default, like the other numeric
limits ([app experience](../app-experience.md)).

## Implementation

| Step                                    | Commit      | What                                                                                 |
| --------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| Room contract, silence, `[Room update]` | `adba04aa5` | `room-contract.ts`, `bot-sessions.ts`, `chat-engine.ts`                              |
| Turns in rounds, preempt, Stop all      | `7f335a8f6` | `discussion.ts`, `mentions.ts`, protocol `chats/mentions.ts`, `chat.discussion.stop` |
| Room instructions, Stop all action      | `f84df1c90` | `room-instructions-field.tsx`, `stop-all-action.tsx`                                 |
| `@` picker and mention display          | `520084d0c` | `member-mentions.ts`, `use-agent-autocomplete.ts`, `chat-rows.tsx`                   |
| Discussion limit, bot Role              | this change | `rounds-field.tsx`, `bot-description-field.tsx`, `chat-participant-settings.tsx`     |

## Later

- Channels: the same rules through the Hub, which needs a sender-is-bot fact, a peer-bot list,
  broadcast mention recognition, and in-process forwarding between bots it hosts, because Telegram
  does not deliver bot messages to other bots.
- An asynchronous bot-to-bot handoff tool (Grok's `SendToAgent`) and a member lookup tool.
- Named room presets and saving a group's instructions as one.
- A read-only view of the whole rendered prompt in Group settings.
- Mention chips with the bot's face instead of bold names.
