# Slack Routing And Follow-Up Tests

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

- `bots.slack.defaults.ackReaction` is left at the default value
- `bots.slack.defaults.typingReaction` is left empty
- `bots.slack.defaults.processingStatus.enabled` is left at the default value
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
- the explicit `group:<id>` route exists for that Slack multi-person direct group

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
- `bots.slack.default.directMessages["*"].policy: "pairing"`
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
- the target group or topic is not yet present under `bots.telegram.default.groups`

### Steps

1. Send `/start` in the unrouted Telegram group or topic
2. Send `/status`
3. Send `/whoami`

### Expected Results

- the group receives a minimal setup reply instead of silence
- the reply includes the exact `clisbot routes add --channel telegram ...` command to run
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
- `bots.slack.default.directMessages["*"].policy: "allowlist"`
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

## Test Case 2IA: Message-Tool Streaming Preview Stays Single-Draft And Cleans Up On Tool Final

### Preconditions

- the routed Slack or Telegram surface uses `responseMode: "message-tool"`
- the route keeps `streaming: "all"` or `streaming: "latest"`
- the agent can send at least one `--progress` reply and one `--final` reply through `clisbot message send ...`

### Steps

1. Start a routed conversation that takes long enough to produce visible preview updates
2. Let clisbot show the initial live draft preview
3. Have the agent send one `clisbot message send --progress ...` reply into the same thread
4. Continue the run so more preview-worthy output appears
5. Finish the run with `clisbot message send --final ...`
6. Compare the final thread state

### Expected Results

- at any moment only one live draft preview is still being edited
- once the tool-owned progress reply lands, the old draft stops changing
- if more preview-worthy output appears later, a new draft appears below that boundary instead of mutating the older draft
- clisbot never posts an extra pane-final reply in addition to the tool-final reply
- when the run completes with `response: "final"`, the disposable draft preview is removed

## Test Case 2J: Message-Tool Heredoc Reply Survives Tricky Multi-Line Content

### Preconditions

- the routed Slack or Telegram surface uses `responseMode: "message-tool"`
- the injected prompt includes the local `clisbot message send ...` reply command
- the local machine has a working wrapper path such as `~/.clisbot/bin/clisbot`

### Steps

1. Start a real routed conversation so the agent receives the message-tool prompt block
2. Use the documented heredoc reply pattern with a body that includes several difficult shapes:
   - multiple lines
   - mixed single and double quotes
   - shell-looking text such as `$HOME`, `$(...)`, backticks, or `)`
   - XML-like or steering-style blocks such as `<system>...</system>`
   - markdown code fences
3. Send that reply through `clisbot message send ...`
4. Verify the delivered surface message text exactly matches the intended body

### Expected Results

- the shell accepts the generated heredoc command without `unexpected EOF` or missing delimiter errors
- `clisbot message send` receives the full body instead of a truncated or reinterpreted shell fragment
- the visible Slack or Telegram reply preserves the original content exactly, including line breaks and quotes
- the route does not emit a second pane-settlement reply when `responseMode` is `message-tool`

## Test Case 2K: `/loop` Times Mode Reserves Ordered Repeats

### Preconditions

- the routed Slack or Telegram surface uses a live agent route
- the route accepts slash commands
- the loop count stays within configured `control.loop.maxRunsPerLoop`

### Steps

1. Send `/loop 3 Reply with exactly LOOP_TIMES_OK and nothing else.`
2. Before the first run settles, send one extra `/queue after the loop say LOOP_QUEUE_OK`
3. Observe the thread order

### Expected Results

- clisbot accepts the `/loop` command and posts a start summary
- the repeated prompt runs exactly 3 times
- the extra queued message stays behind those 3 reserved loop iterations
- no fourth loop run appears

## Test Case 2L: `/loop` Interval Mode Is Managed, Bounded, And Restored

### Preconditions

- the routed Slack or Telegram surface uses a live agent route
- the route accepts slash commands
- the route supports `message-tool` response mode for the cleanest live validation

### Steps

1. Send `/loop 1m --force Reply with exactly LOOP_INTERVAL_OK and nothing else.`
2. Observe the immediate first run
3. Run `/loop status`
4. Restart the runtime
5. Run `/loop status` again
6. Cancel the loop with `/loop cancel <id>`

### Expected Results

- clisbot accepts the `/loop` command and posts a start summary
- the first run starts immediately
- the start summary includes loop id, max runs, active loop counts, and cancel guidance
- `/loop status` shows the active loop with remaining runs and next run time
- after restart, the loop still appears in `/loop status`
- `/loop cancel <id>` removes the loop from active state

## Test Case 2M: `/loop` Maintenance Mode Uses `LOOP.md`

### Preconditions

- the routed agent workspace contains a non-empty `LOOP.md`

### Steps

1. Send `/loop 3`
2. Observe the routed conversation

### Expected Results

- clisbot loads prompt text from workspace `LOOP.md`
- the maintenance loop runs exactly 3 times
- if `LOOP.md` is removed and the same command is retried, clisbot fails with a direct remediation message instead of guessing a prompt

## Test Case 2N: `/loop` Wall-Clock Schedule Uses Resolved Timezone

### Preconditions

- the routed Slack or Telegram surface uses a live agent route
- `app.timezone` is configured, or the route has an explicit timezone override

### Steps

1. Send `/loop every day at 07:00 Reply with exactly LOOP_DAILY_OK and nothing else.`
2. Observe the acceptance message
3. Run `/loop status`
4. Restart the runtime
5. Run `/loop status` again

### Expected Results

- clisbot accepts the command and posts a start summary
- the summary includes the resolved timezone and the first `nextRunAt`
- the first run is not started immediately; it is scheduled for the next matching wall-clock time
- `/loop status` shows the schedule form and timezone
- after restart, the same loop remains visible with its persisted effective timezone

## OpenClaw Compatibility Note

Latest OpenClaw `main` models Slack no-mention thread continuation by remembering that it already replied in a thread.

That means the compatibility target is:

- "the bot has already replied in this thread"

not:

- "the bot authored the thread root"

`clisbot` may implement that target by cache or by thread inspection, but the user-visible behavior should match the same rule.
