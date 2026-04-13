# Configuration Tests

## Purpose

These test cases define the expected behavior of configuration as the local control plane for `clisbot`.

They cover config bootstrap, env substitution, and how the system wiring is resolved across channels, the agents layer, runners, and control.

## Test Case 1: Default Config Bootstrap Works

### Preconditions

- `~/.clisbot/clisbot.json` does not exist

### Steps

1. Run `bun run init`
2. Open the generated config file

### Expected Results

- the file is created at `~/.clisbot/clisbot.json`
- the tmux socket path is `~/.clisbot/state/clisbot.sock`
- the default agent workspace is `~/.clisbot/workspaces/default`
- the generated Slack `channels` map is empty
- the generated Telegram `groups` map is empty

## Test Case 2: Start Refuses First Run Without Default Channel Tokens

### Preconditions

- `~/.clisbot/clisbot.json` does not exist
- `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, and `TELEGRAM_BOT_TOKEN` are all unset

### Steps

1. Run `bun run start`

### Expected Results

- `clisbot` prints a warning instead of starting
- `clisbot` points the operator to `docs/user-guide/channel-accounts.md`
- `clisbot` does not create the runtime config or pid state

## Test Case 3: Env Substitution Fails Loudly On Missing Vars

### Preconditions

- one required Slack env var is unset

### Steps

1. Attempt to load the config through the normal startup path

### Expected Results

- startup fails clearly
- the failure points to the missing environment variable instead of silently misconfiguring the runtime
- the operator sees a friendly error message without a raw source-code exception dump

## Test Case 4: Channel Route Policy Resolves Predictably

### Preconditions

- a config file exists with at least one explicit channel route

### Steps

1. Start the service with `channelPolicy: "allowlist"` and `groupPolicy: "allowlist"`
2. Send traffic from an allowed channel
3. Send traffic from a non-listed channel
4. Repeat with `channelPolicy: "open"`
5. Repeat with `groupPolicy: "open"` for a Slack MPIM route

### Expected Results

- allowlisted channels route to the configured agent
- non-listed channels are rejected under `channelPolicy: "allowlist"`
- open-channel behavior remains mention-gated unless the config explicitly changes that rule
- Slack MPIM group behavior is controlled independently by `groupPolicy`

## Test Case 5: Runner And Interaction Policy Resolve From One Config Source

### Preconditions

- a config file exists with at least one agent definition and one channel route

### Steps

1. configure an agent to use the tmux runner
2. configure the default interaction policy for that route to use chat-first rendering
3. configure an explicit transcript request command pattern for that route
4. configure `streaming` and `response` for that route
5. start the service and inspect the resolved runtime wiring

### Expected Results

- runner selection comes from explicit configuration rather than hidden defaults
- default chat rendering and transcript request behavior are resolved from the same config source
- `streaming: off | latest | all` and `response: all | final` resolve from the same config source
- channel edit-versus-append behavior is not overloaded into `streaming` policy
- the resolved system wiring is stable enough for operators and tests to predict behavior before sending traffic

## Test Case 6: Session Continuity Storage And Runner Session-Id Policy Resolve Together

### Preconditions

- a config file exists with one agent definition

### Steps

1. configure `session.storePath`
2. configure `runner.sessionId.create`
3. configure `runner.sessionId.capture`
4. configure `runner.sessionId.resume`
5. load the config through the normal runtime path

### Expected Results

- `session.storePath` resolves to an expanded absolute path
- the default config expresses a valid Codex-style session-id strategy
- Codex runner-native create does not include an unused explicit `--session-id` arg
- the runtime can switch to an explicit-session-id strategy without code changes
- session-id acquisition remains a runner concern rather than leaking into channel config

## Test Case 7: Follow-Up Policy Defaults Resolve Predictably

### Preconditions

- a config file exists with at least one Slack route

### Steps

1. configure one route with default follow-up mode set to natural continuation after bot reply
2. configure one route with default follow-up mode set to mention-only
3. configure one route with a specific follow-up participation TTL
4. load the config through the normal runtime path

### Expected Results

- the resolved config exposes one explicit default follow-up mode per route or inherited default
- the resolved config exposes the configured follow-up TTL in normalized form
- the follow-up defaults are clearly separate from `requireMention`, `streaming`, and `response`
- the config makes it possible to express OpenClaw-compatible bot-participated thread continuation without hardcoding the TTL
- minute-based config such as `participationTtlMin: 5` is the default user-facing form
- second-based config such as `participationTtlSec` is also accepted for tighter test cases

## Test Case 8: Slack Feedback Defaults Resolve Predictably

### Preconditions

- a config file exists with Slack enabled

### Steps

1. load the config without explicitly setting `channels.slack.ackReaction`
2. load the config without explicitly setting `channels.slack.typingReaction`
3. load the config without explicitly setting `channels.slack.processingStatus`
4. load the config again with all three values explicitly set

### Expected Results

- the default resolved Slack config exposes `ackReaction: ""`
- the default resolved Slack config exposes `typingReaction: ""`
- the default resolved Slack config exposes `processingStatus.enabled: true`
- the default resolved Slack config exposes `processingStatus.status: "Working..."`
- the default resolved Slack config exposes `processingStatus.loadingMessages: []`
- explicit values override the defaults without changing any other channel routing behavior

## Test Case 9: Config Reload Policy Resolves Predictably

### Preconditions

- a config file exists

### Steps

1. load the config without explicitly setting `control.configReload`
2. load the config again with `control.configReload.watch: true`
3. load the config again with `control.configReload.watchDebounceMs` overridden

### Expected Results

- the default resolved config exposes `control.configReload.watch: false`
- the default resolved config exposes `control.configReload.watchDebounceMs: 250`
- explicit values override the defaults without affecting unrelated channel or agent settings

## Test Case 10: Stale tmux Cleanup Policy Resolves Predictably

### Preconditions

- a config file exists with at least one agent definition

### Steps

1. load the config without explicitly setting `agents.defaults.session.staleAfterMinutes`
2. load the config again with `agents.defaults.session.staleAfterMinutes` overridden
3. load the config again with `control.sessionCleanup.enabled` overridden
4. load the config again with `control.sessionCleanup.intervalMinutes` overridden

### Expected Results

- the default resolved config exposes `agents.defaults.session.staleAfterMinutes: 60`
- the default resolved config exposes `control.sessionCleanup.enabled: true`
- the default resolved config exposes `control.sessionCleanup.intervalMinutes: 5`
- explicit values override the defaults without changing session-id continuity config
- `staleAfterMinutes: 0` is treated as an explicit per-agent disable for stale tmux cleanup
- cleanup uses clisbot activity timestamps and skips busy sessions instead of inferring staleness from tmux CPU usage

## Test Case 11: DM Access Policy Resolves Predictably

### Preconditions

- a config file exists with Slack or Telegram enabled

### Steps

1. load the config without explicitly setting `directMessages.policy`
2. load the config without explicitly setting `directMessages.allowFrom`
3. load the config again with `directMessages.policy: "pairing"`
4. load the config again with `directMessages.policy: "allowlist"` and a non-empty `allowFrom`

### Expected Results

- the default resolved config exposes `directMessages.policy: "pairing"`
- the default resolved config exposes `directMessages.allowFrom: []`
- explicit DM access policies resolve without affecting unrelated route behavior
- `allowFrom` resolves as a plain sender list that is later merged with the runtime pairing store
