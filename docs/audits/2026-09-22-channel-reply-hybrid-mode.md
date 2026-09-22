# How a channel turn reaches the user: Text forward, Channel tool, and Hybrid

**Decided 2026-09-22, implemented 2026-09-23.** The mechanism as built is in
[conversation-flow.md § Reply method](../features/channels/conversation-flow.md#reply-method); this
file is the record of why.

## The problem

A Route picks a Reply method, stored as `outbound.path`:

| UI label         | `outbound.path` | What the user sees                                                                                                                                                                  |
| ---------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text forward     | `relay`         | The Hub relays the agent's assistant messages. No `channel_reply` tool, so the agent cannot send files, images, reactions or edits.                                                 |
| Use Channel tool | `tool`          | Only what the agent sends through `mcp__channel_reply__message`. `toolPathSyncFold` (`hub/channels/config/inheritance.ts`) turns relay text off so the two paths never double-post. |

Neither path works well on its own:

- **Channel tool hides the conversation.** Someone who opens the session in the Paseo app sees tool calls and a closing "Sent." instead of the reply.
- **Channel tool can end in silence.** Nothing records whether a turn sent anything. A turn that fails, is canceled, or finishes without calling the tool shows the user nothing. The tool's `final` flag is echoed back to the agent and does nothing else (`channel-reply-send.ts`).
- **Text forward cannot act.** With no tool attached, the agent cannot send a file or image, react, or edit a message.
- **Text forward also loses errors (from reading the code; no test covers it yet).** On failure the server appends `[System Error] …` as an assistant message with no managed turn id (`server/.../agent-manager.ts` `appendSystemErrorTimelineMessage`). The relay files it under turn key `""`, which is never flushed. `onTurnClosed` then drops the in-flight message. This contradicts conversation-flow.md, which says a failed turn's error is posted in the thread.

## Options

| Option                                                      | Why not                                                                                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Keep two paths and fix only the silence                     | Channel tool still hides the reply from the Paseo app.                                                                            |
| Add a separate "attach Channel tool" switch on Text forward | Two fields describe one choice, and inheritance has to resolve a combination that makes no sense (tool path with the switch off). |
| **Add a third value `outbound.path: "hybrid"`**             | **Chosen.** One field, one choice. Inheritance and the form stay a single segmented control.                                      |

## The decision

### 1. `hybrid` is the default Reply method for new Routes

The UI offers three options, recommended one first: **Hybrid** (`hybrid`), **Text forward** (`relay`), **Channel tool only** (`tool`).

- Relay text sync stays on, as it does on `relay`. The final answer streams as text, so the Paseo app and the channel show the same thing, and errors come through the same route.
- The Hub attaches `channel_reply` with its preapproval and capability exactly as on `tool` (`control-plane.ts`, `bindings/session-create.ts`, `commands-lifecycle.ts` `capabilityFor`, and the Workflow path in `daemons/lifecycle.ts`).
- The injected block tells the agent the opposite of the `tool` block: its final message **is** delivered as text; use the tool only for files and images, reactions and edits; never repeat the reply text through the tool.
- The Hub deduplicates instead of trusting the prompt. If a `send` this turn already carried text that matches the final answer after normalization, the relay does not post that final answer again.

**Existing Routes keep their stored value.** Only new Routes and the app-side defaults (`app/src/clisbot/hub/channel-configuration.ts`) change to `hybrid`. There is no migration.

### 2. Failed turns are always reported, on every path

On `turn_failed`, the Hub posts one notice into the source conversation, for example `⚠️ The agent stopped with an error: <short error>`. It flushes any in-flight assistant text first, on the paths that relay text. This replaces the silent `onTurnClosed` drop and fixes the Text forward error loss above.

Amended while implementing: `turn_canceled` posts nothing. A cancel is `/stop` or a message that interrupts the turn, both deliberate, and a notice there reads as a failure that did not happen.

### 3. A completed `tool` turn with no reply falls back with care

The risk: forwarding the agent's final message when it already answered through the tool double-posts, or adds noise after a file or reaction that was the answer. So the Hub records what the tool actually delivered in the turn (successful calls only) and forwards the last message only when nothing answered and no visible action stood in for an answer. The fallback sends text, never a file. The rule table is in [conversation-flow.md § Reply method](../features/channels/conversation-flow.md#reply-method).

This gives `final` a meaning, so the `tool` block must say "omit `final` or set it true on your answer" (it already does).

### 4. Progress on `tool`: a short prompt, with a Hub-side limit

- The `tool` block gains one line: on longer work, send a short `final=false` update when you start and at major steps, at most about once a minute.
- The Hub enforces the pace. A `final=false` send less than 30 s after the previous one that landed is not posted. The agent gets `status: "throttled"`, so it knows the update did not go out. Answers (`final` true or omitted) are never throttled.
- The rest of the `tool` block stays as short as Codex allows. The three facts in [codex-channel.md](../features/channels/codex-channel.md) must survive any rewrite.

## Implementation notes

Changed after the first review (2026-09-23):

- **Only a channel turn is owed a fallback or a `tool` failure notice.** The relay sees every turn of a bound session, including turns started in the Paseo app and turns the Agent starts itself. The first cut forwarded those into the channel on `tool`. A capability now marks its record `channelTurn` when the channel mints it with a turn or `noteTurn` stamps a follow-up; the relay acts on `tool` only when the mark is there. A canceled turn passes the mark on (second review: a message that replaces a running turn cancels it first, and taking the mark there silenced the new turn). A channel turn that misses the mark stays silent, which is the behavior before this change. `relay` and `hybrid` already relay app turns' text, so their failure notice is not gated.
- **A replayed turn end does nothing.** Both handlers return when the turn is already closed; the ledger alone did not dedupe, because each post takes a new sequence.
- **Actions are classified against the core vocabulary** (`channel-reply-turn-record.ts`), so a new action name fails the type check until it is sorted into answer, act or read.
- **The progress window starts when a progress send lands,** not when it is admitted, so a failed send does not cost the next update 30 s.
- **The app no longer writes a Reply method the owner did not pick.** A stored Route without `outbound.path` shows the path it inherits and saves without the key.

Still true:

- The record lives on the capability registry, keyed by Agent, and the relay takes it when the turn ends. A tool call that lands for the next turn before the relay has processed the previous turn's end is counted for the previous one.
- The `[System Error]` loss on Text forward was confirmed by a test (`relay/turn-end.test.ts`) before the fix.
