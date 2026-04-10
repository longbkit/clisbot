# Channel Tests

## Purpose

These test cases define the ground truth for user-facing conversation surfaces.

They should be used for ad hoc validation and later automation across Slack first, then API and other channels.

## Environment

- `.env` contains valid `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, and `SLACK_TEST_CHANNEL`
- `~/.clisbot/clisbot.json` routes `SLACK_TEST_CHANNEL` to agent `default`
- mention-path validation works with `app_mention`
- implicit no-mention follow-up validation requires the Slack app to subscribe to the routed `message.*` event family, not only `app_mention`
- for channel threads, `message.channels` is the critical Slack subscription
- for Slack, natural no-mention continuation means the bot has already replied in that thread; it does not require the bot to have authored the thread root
- the channel configuration enables default chat-first rendering and any transcript request command used by the test
- `bun run dev` is running

## Test Case 1: Slack Mention Starts A Run

### Preconditions

- `SLACK_TEST_CHANNEL` is reachable by the bot
- no operator is manually typing into the mapped agent session

### Steps

1. Send a message in `SLACK_TEST_CHANNEL` that explicitly mentions the bot and asks for `Reply with exactly PONG and nothing else.`
2. Watch the service logs.
3. Watch the Slack thread created from that message.

### Expected Results

- the Slack event is accepted exactly once
- the inbound user message receives the configured ack reaction
- a placeholder or streaming response appears in the same Slack thread
- the mapped agent receives the prompt
- the final Slack reply settles to a result containing `PONG`
- `/status` in that same routed conversation reports the current follow-up mode and route help

## Test Case 1A: Default Slack Feedback Uses Live Reply Without Ack Reaction

### Preconditions

- `channels.slack.ackReaction` is left at the default value
- `channels.slack.typingReaction` is left empty
- `channels.slack.processingStatus.enabled` is left at the default value
- the Slack app has bot scope `reactions:write`
- the Slack app has bot scope `chat:write` or `assistant:write`

### Steps

1. Send a bot mention in `SLACK_TEST_CHANNEL`
2. Watch the inbound user message immediately after the event is accepted
3. Watch the Slack thread while the runner is still working

### Expected Results

- the inbound user message does not receive an ack reaction by default
- no extra typing reaction is added by default
- the thread shows Slack assistant processing status such as `Working...`
- the main processing feedback is still the live bot reply inside the thread
- completion removes only temporary in-thread processing text

If `reactions:write` or the accepted Slack status scope is missing, expected degraded behavior is:

- the live bot reply still appears and completes normally
- the missing feedback surface is skipped without breaking prompt handling

## Test Case 2: Thread Follow-Up Continues The Same Conversation

### Preconditions

- Test Case 1 has already completed successfully
- the Slack app is subscribed to the routed `message.*` event family for this conversation kind

### Steps

1. In the same Slack thread, send a follow-up such as `say exactly PONG again`
2. Do not create a new top-level Slack message
3. Do not repeat the bot mention once the bot has already replied in that thread
4. Watch the same Slack thread and the mapped agent state

### Expected Results

- the follow-up is routed to the same logical conversation
- the follow-up is accepted as a normal thread continuation after the bot has already participated in that thread
- the follow-up resolves to the same thread-backed session key as the prior turn
- the system does not create a second unrelated agent session for the same thread
- the Slack thread receives the updated result in-thread

Live proof on April 5, 2026:

- top-level mention at thread `1775377416.386429` produced bot reply `READY2`
- later plain reply `what about tomorrow now?` in the same thread was accepted without a fresh mention
- the bot answered in the same thread after `message.channels` had been added to the Slack app subscriptions

## Test Case 2A: A New Top-Level Slack Message Starts A Different Session

### Preconditions

- Test Case 1 has already completed successfully

### Steps

1. Send a second top-level mention in `SLACK_TEST_CHANNEL`
2. Do not reply inside the first Slack thread
3. Inspect Slack replies and the tmux session list

### Expected Results

- the second top-level message starts a new Slack thread
- the second top-level message resolves to a different session key from the first
- the agent workspace is still reused because both routes point to the same agent
- the system does not leak the first thread conversation into the second by reusing one shared tmux session

## Test Case 2B: Slack Multi-Person Direct Group Uses A Group Session

### Preconditions

- the Slack app is present in a multi-person direct group
- the group route is allowed by `groupPolicy` or an explicit `groups` route

### Steps

1. Send a message in the multi-person direct group
2. Repeat in the same group
3. Compare the tmux session identity with a one-to-one Slack DM session

### Expected Results

- the group conversation resolves as a Slack `group` session, not a DM session
- the group does not collapse into the DM main session controlled by `session.dmScope`
- repeated messages in the same group reuse that same group session key

## Test Case 2C: DM Mention Gating Follows Config

### Preconditions

- one Slack DM route exists
- `directMessages.requireMention` is set explicitly for the test case

### Steps

1. Set `directMessages.requireMention: false` and send a plain DM without mentioning the bot
2. Set `directMessages.requireMention: true` and send a plain DM without mentioning the bot
3. In the same config, send a DM that explicitly mentions the bot

### Expected Results

- with `directMessages.requireMention: false`, the plain DM is accepted
- with `directMessages.requireMention: true`, the plain DM is ignored
- with `directMessages.requireMention: true`, the explicit bot mention is accepted

## Test Case 2F: Slack DM Pairing Gates Unknown Senders Before Any Session Starts

### Preconditions

- one Slack DM route exists
- `channels.slack.directMessages.policy: "pairing"`
- the test sender is not already present in config `allowFrom`
- the test sender is not already approved in `~/.clisbot/state/pairing`

### Steps

1. Send a plain Slack DM to the bot from the unapproved sender
2. Watch the DM reply and service logs
3. Run `bun run pairing -- list slack`
4. Approve the returned code with `bun run pairing -- approve slack <CODE>`
5. Send another DM from the same sender
6. Inspect the agent session list and normal reply behavior

### Expected Results

- the first DM does not reach normal session routing or runner execution
- the bot replies with one pairing code message for that sender
- repeated unapproved DMs reuse the existing pending code instead of spamming new codes
- `bun run pairing -- list slack` shows the pending request before approval
- `bun run pairing -- approve slack <CODE>` removes the pending request and grants access
- the next DM from the same sender is accepted and handled as a normal conversation

## Test Case 2H: Telegram Unrouted Group Shows Safe Setup Help

### Preconditions

- Telegram channel support is enabled
- the bot is present in the configured Telegram test group
- the target group or topic is not yet present in `channels.telegram.groups`

### Steps

1. Send `/start` in the unrouted Telegram group or topic
2. Send `/status`
3. Send `/whoami`

### Expected Results

- the group receives a minimal setup reply instead of silence
- the reply includes the exact `clisbot channels add telegram-group ...` command to run
- `/whoami` exposes `chatId` and `topicId` when applicable
- sensitive commands such as `/transcript`, `/stop`, `/followup`, and `/bash` are not advertised for the unrouted group yet

## Test Case 2I: Telegram Topic Keeps Typing Visible During Active Work

### Preconditions

- Telegram routing is enabled for the configured test topic
- the topic route points to a working agent

### Steps

1. Send a prompt in the routed Telegram topic that keeps the runner busy for several seconds
2. Watch the topic before the first visible bot reply appears
3. Keep watching while the run is still active

### Expected Results

- Telegram shows typing feedback in the same topic soon after the message is accepted
- typing remains visible during active work instead of flashing only once
- the eventual live reply and final reply still stay in the same topic

## Test Case 2G: Slack DM Allowlist Policy Blocks Unknown Senders Silently

### Preconditions

- one Slack DM route exists
- `channels.slack.directMessages.policy: "allowlist"`
- the test sender is not present in config `allowFrom`
- the test sender is not present in the pairing allowlist store

### Steps

1. Send a Slack DM from the unapproved sender
2. Watch the DM and service logs
3. Approve or configure the sender into the allowlist
4. Send another DM from the same sender

### Expected Results

- the first DM is ignored without starting a runner
- no pairing code is issued in `allowlist` mode
- once the sender is approved or configured, the next DM is accepted normally

## Test Case 2D: Killed tmux Session Recovers In The Same Slack Thread

### Preconditions

- Test Case 1 has already completed successfully
- the routed runner supports stored session-id resume
- the current Slack thread already maps to one persisted session entry

### Steps

1. Record the current thread-backed session key and stored runner `sessionId` from logs or session state
2. Kill the mapped tmux session for that Slack thread
3. Send a new prompt in the same Slack thread
4. Watch the recreated tmux session, service logs, and Slack replies

### Expected Results

- clisbot recreates the missing tmux session instead of treating the thread as lost
- the follow-up stays on the same thread-backed session key
- the recreated runner launches in resume mode using the stored runner `sessionId`
- the Slack thread receives the continued reply in-thread without creating a new unrelated conversation

## Test Case 2E: No-Mention Thread Follow-Up Fails Cleanly Without Slack Message Events

### Preconditions

- Test Case 1 has already completed successfully
- the Slack app is not subscribed to the routed `message.*` event family for this conversation kind

### Steps

1. In the same Slack thread, send a plain follow-up without mentioning the bot
2. Wait for the normal processing window
3. In the same thread, send another follow-up that explicitly mentions the bot

### Expected Results

- the plain no-mention follow-up does not enqueue a new prompt because the service never receives the needed message event
- no misleading partial or final Slack reply is produced for that missed follow-up
- the explicit mention still works because `app_mention` continues to reach the service

## Test Case 2I: Message-Tool Reply Still Enables No-Mention Slack Follow-Up

### Preconditions

- `SLACK_TEST_CHANNEL` is routed and reachable
- the Slack app is subscribed to `message.channels` for this routed channel thread
- the routed channel or inherited config uses `responseMode: "message-tool"`
- the active agent replies through `clisbot message send ...` into the same Slack thread
- the thread already has one successful bot reply delivered through the message tool path

### Steps

1. Send a top-level mention in `SLACK_TEST_CHANNEL` to start a routed thread
2. Let the agent send its visible reply with `clisbot message send ...` instead of pane-settlement delivery
3. In the same Slack thread, send a plain follow-up without mentioning the bot
4. Watch the Slack thread, runtime logs, and session identity

### Expected Results

- the message-tool reply still marks the conversation as bot-participated for follow-up purposes
- the plain no-mention follow-up is accepted as a normal thread continuation
- the follow-up resolves to the same thread-backed session key as the prior turn
- the system does not require a fresh explicit mention only because the previous reply came from `clisbot message send ...`
- no duplicate pane-settlement reply appears when `responseMode` stays on `message-tool`

## OpenClaw Compatibility Note

Latest OpenClaw `main` models Slack no-mention thread continuation by remembering that it already replied in a thread.

That means the compatibility target is:

- "the bot has already replied in this thread"

not:

- "the bot authored the thread root"

`clisbot` may implement that target by cache or by thread inspection, but the user-visible behavior should match the same rule.

## Test Case 3: Default Interaction Strips Runner Chrome

### Preconditions

- the mapped runner emits visible header or footer chrome during a prompt

### Steps

1. Send a prompt that produces a multi-step response
2. Observe the streamed updates in the channel
3. Compare the visible channel output with the raw runner transcript if needed

### Expected Results

- the channel shows only new interaction content needed by the user
- repeated top chrome, bottom chrome, and unrelated static frame content are stripped
- the rendered output reads as a seamless chat transcript rather than a full terminal dump

## Test Case 3A: Inbound Files Become Workspace-Local Attachment Paths

### Preconditions

- the routed Slack or Telegram surface supports inbound files
- the mapped agent workspace is writable

### Steps

1. Send a message with one attached file and normal text
2. Inspect the mapped agent workspace
3. Inspect the actual prompt received by the runner if needed
4. Repeat with a file-only message

### Expected Results

- the file is saved under `{workspace}/.attachments/{sessionKey}/{messageId}/...`
- the runner receives the stored file as an `@/absolute/path` mention before the user text
- file-only messages still produce a usable prompt from the attachment path alone
- slash commands are not rewritten into attachment-prefixed prompts

## Test Case 4: Slack Streams Only Meaningful New Content

### Preconditions

- the mapped runner emits multiple intermediate updates for one interaction

### Steps

1. Send a Slack prompt that causes Codex to think for several steps before the final answer
2. Watch each Slack thread update as the runner progresses
3. Compare each Slack-visible update with the underlying normalized runner updates

### Expected Results

- Slack updates appear only when new meaningful content is produced
- unchanged full-screen redraws do not produce new Slack-visible output
- repeated Codex chrome is not re-sent as if it were fresh progress
- the user can follow progress without reading the whole tmux screen each time

## Test Case 5: Streaming Policy Changes Slack Thread Behavior Predictably

### Preconditions

- the channel route supports `streaming: off | latest | all`

### Steps

1. Run one prompt with `streaming: "off"`
2. Run one prompt with `streaming: "latest"`
3. Run one prompt with `streaming: "all"`
4. Compare the Slack thread behavior for each run

### Expected Results

- `off` produces no intermediate streamed replies before the final answer
- `latest` keeps one in-progress reply updated to the latest visible state
- `all` keeps one in-progress reply updated in place while preserving all streamed content in that live reply
- all three modes still preserve the chat-first text shaping rules for content quality

## Test Case 5A: Channels With Edit Support Update The Live Reply Instead Of Posting New Progress Replies

### Preconditions

- the target channel supports message editing
- the channel route uses streaming enabled behavior

### Steps

1. Send a prompt that produces multiple visible intermediate updates
2. Observe the thread while the interaction is still running
3. Compare the number of bot replies before and after completion

### Expected Results

- the channel uses one live bot reply for in-progress streaming instead of posting a new reply for each progress update
- the live reply text changes over time as new output arrives
- completion settles by editing that same live reply when the channel supports it

## Test Case 5B: Telegram Does Not Globally Block Unrelated Conversations

### Preconditions

- Telegram routing is enabled for at least two independent conversation surfaces such as two topics or one DM plus one topic
- one routed agent can be kept busy long enough to observe a second inbound message during processing

### Steps

1. In Telegram conversation A, send a prompt that keeps the runner busy for a noticeable period
2. Before conversation A finishes, send a simple prompt in Telegram conversation B
3. Watch service logs and both Telegram conversations

### Expected Results

- conversation B is accepted while conversation A is still running
- conversation B receives typing or reply feedback without waiting for conversation A to finish
- conversation B reaches its own reply path even though conversation A is still active
- only same-session execution remains serialized; unrelated Telegram conversations do not block each other at channel-ingestion time

## Test Case 6: Slack Settles To One Clean Final Answer

### Preconditions

- default chat-first interaction rendering is enabled

### Steps

1. Send a prompt that causes at least one intermediate update and one final answer
2. Wait until the runner reaches its final settled state
3. Inspect the final visible Slack thread state

### Expected Results

- in-progress noise does not remain as the dominant final user-visible output
- the final thread state shows the clean final answer for that interaction
- any retained progress text remains subordinate to the final answer instead of obscuring it

## Test Case 7: Long Final Answers Reconcile Into Ordered Slack Chunks

### Preconditions

- default chat-first interaction rendering is enabled
- the interaction produces enough progress logs and final answer text to exceed the Slack message size cap

### Steps

1. Send a prompt that causes multiple progress updates followed by a long final answer
2. Wait for the final settled Slack reply
3. Compare the final Slack reply with the raw tmux transcript

### Expected Results

- the settled Slack output is preserved across an ordered set of thread replies instead of being truncated into one message
- the first settled chunk starts at the beginning of the final answer rather than in the middle of a sentence
- chunk order stays stable as the live reply is edited
- stale trailing chunks are removed if a later normalized view becomes shorter
- progress-only blocks such as repeated search or tool activity are removed when a cleaner final answer exists

## Test Case 8: Response Policy Controls Whether Streamed Replies Remain Visible

### Preconditions

- the channel route supports `response: all | final`
- the interaction produces at least one streamed intermediate update and one final answer

### Steps

1. Run one prompt with `response: "all"`
2. Run one prompt with `response: "final"`
3. Compare the settled Slack thread state after completion

### Expected Results

- `all` keeps the streamed intermediate replies visible in the thread
- `final` leaves only the final settled reply visible for that interaction
- both policies preserve the same final answer quality rules

## Test Case 8A: Response All Does Not Replay Already-Streamed Content At Completion

### Preconditions

- the channel route uses `streaming: "all"`
- the channel route uses `response: "all"`
- the interaction produces at least one streamed update before the final settled state

### Steps

1. Send a prompt that causes visible intermediate progress and a final answer
2. Wait until the interaction reaches the final settled Slack state
3. Compare the final thread replies in order

### Expected Results

- the final settlement does not repost the same already-streamed answer block again
- if completion adds no new visible content, no duplicate final reply is posted
- if completion adds new visible content, Slack posts only the missing delta rather than replaying the whole answer

## Test Case 9: Explicit Transcript Request Returns Full Session Visibility

### Preconditions

- an explicit transcript request command is enabled for the channel
- at least one prior interaction has already produced visible tmux session content

### Steps

1. In the same Slack thread, invoke the transcript request command pattern
2. Observe the returned Slack-visible transcript response
3. Send another normal prompt after the transcript response

### Expected Results

- the transcript response returns the whole current session view closely enough for inspection
- terminal chrome may be present in the transcript response when it exists in tmux
- the transcript response is clearly separate from normal interaction streaming behavior
- the next normal prompt still returns to meaningful-only chat-first streaming

## Test Case 9A: Reserved Control Slash Commands Take Priority Over Native Agent Slash Commands

### Preconditions

- the routed channel supports normal bot mentions or thread follow-up
- a live agent session exists or can be created

### Steps

1. Send `/transcript` in a valid bot conversation path
2. Send `/stop` in the same path while the agent is busy or immediately after a run
3. Send a non-reserved slash command such as `/model`

### Expected Results

- `/transcript` is handled by clisbot and returns the current full conversation session transcript
- `/stop` sends `Escape` to interrupt current processing in the current conversation session
- reserved control slash commands are not forwarded to the native runner
- non-reserved slash commands are forwarded unchanged to the agent CLI

### Identity Slash Command

1. Send `/whoami` in Slack or Telegram on an allowed route
2. Observe the immediate clisbot reply

Expected:

- the command is handled by clisbot as a reserved control slash command
- Slack replies include sender id, channel id, and thread ts when present
- Telegram replies include sender id, chat id, and topic id when present
- the reply includes the resolved `agentId` and `sessionKey`

## Test Case 9B: Agent Bash Commands Can Be Triggered From The Channel

### Preconditions

- a valid bot conversation path exists
- the routed agent workspace contains a readable git or file state

### Steps

1. Send `/bash pwd`
2. Send `!git diff`
3. Observe the returned channel output

### Expected Results

- `/bash` runs the provided command in the current agent workspace
- `!command` behaves as shorthand for agent-scoped bash execution
- the returned output is the command result, not a forwarded natural-language prompt
- control slash commands still keep higher priority than bash execution commands

## Test Case 9C: Sensitive Commands Stay Disabled Unless The Route Opts In

### Preconditions

- one channel, group, topic, or DM route exists without `privilegeCommands.enabled: true`

### Steps

1. Send `/transcript`
2. Send a configured slash-style transcript shortcut such as `::transcript` or `\transcript`
3. Send `/bash pwd`
4. Send `!git diff`

### Expected Results

- clisbot denies each request with a clear route-policy message
- transcript inspection is not executed
- bash execution is not executed
- enabling `privilegeCommands.enabled: true` on that route allows the same commands on the next turn

## Test Case 10: Follow-Up Slack Interaction Does Not Repeat Previous Static Chrome

### Preconditions

- one prior Slack interaction has already completed in the same thread
- default chat-first interaction rendering is enabled

### Steps

1. Send a second prompt in the same Slack thread
2. Observe the first streamed update for that new interaction

### Expected Results

- the new interaction does not resend the entire prior Codex frame as though it were new content
- any static session header that remains in the tmux pane is suppressed from Slack unless it changes meaningfully
- the first user-visible update for the new interaction reflects the new work rather than old pane residue

## Test Case 11: API Channel Streams A Compatible Response

### Preconditions

- the API channel is enabled
- at least one agent is configured

### Steps

1. Send a minimal compatible request asking for `Reply with exactly PONG and nothing else.`
2. Repeat with streaming enabled and a prompt that takes long enough to emit intermediate progress

### Expected Results

- the request is accepted through the configured API channel
- the request maps to a configured long-lived agent instead of a disposable one-off process
- the non-streaming response returns `PONG`
- the streaming response emits ordered incremental updates and terminates cleanly
