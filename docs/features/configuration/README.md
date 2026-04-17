# Configuration

## Summary

Configuration is the local control plane for `clisbot`.

It defines how channels, auth, Agents, runners, and control are wired together.

It also defines how runner-owned AI CLI session ids are created, captured, resumed, and persisted.

It also defines default conversation follow-up policy and follow-up participation windows for channels that support natural continuation.

It also defines stale tmux cleanup policy so runner residency does not grow forever.

It also defines route transcript visibility policy and auth-relevant shell execution policy inputs.

It also defines first-run startup bootstrap behavior for default channel accounts and the first default agent.

It also defines persisted auth policy config used by the auth system for operator and routed actions.

## State

Active

## Why It Exists

The system needs one explicit place to define:

- channel routes
- Slack conversation-kind routes for channels, groups, and direct messages
- agent definitions
- runner selection
- workspace defaults
- policy flags
- direct-message access policy and allowlists
- chat-first rendering policy
- transcript request command configuration
- transcript visibility policy and shell execution policy inputs
- `streaming: off | latest | all`
- `response: all | final`
- default follow-up policy such as auto-follow or mention-only
- follow-up participation window and default reset behavior
- Slack feedback such as `ackReaction`, `typingReaction`, and `processingStatus`
- operator reload policy such as `control.configReload.watch`
- OpenClaw-compatible session controls such as `session.mainKey`, `session.dmScope`, and `session.identityLinks`
- session continuity storage such as `session.storePath`
- stale tmux cleanup thresholds such as `session.staleAfterMinutes`
- runner session-id strategy such as `runner.sessionId.create`, `runner.sessionId.capture`, and `runner.sessionId.resume`
- turn execution timers such as `stream.idleTimeoutMs`, `stream.noOutputTimeoutMs`, `stream.maxRuntimeMin`, and `stream.maxRuntimeSec`
- stale cleanup loop policy such as `control.sessionCleanup.enabled` and `control.sessionCleanup.intervalMinutes`
- persisted auth policy such as `app.auth` and `agents.<id>.auth`

Without that, the implementation will drift into hidden defaults and hand-wired behavior.

Current policy meaning:

- `streaming` controls how much in-progress content is retained in the live rendered reply
- `streaming` now governs live preview visibility for both `capture-pane` and `message-tool`
- `response` controls whether completion keeps the accumulated streamed content or settles to the clean final answer only
- in `message-tool`, `response` mainly controls what happens to the disposable draft preview after tool-final delivery or fallback settlement
- channel edit capability is not chosen by `streaming`; channels that support edits should prefer editing one live reply during streaming
- follow-up policy controls whether a thread continues naturally after the bot has replied, requires explicit mention every time, or is temporarily paused

## Scope

- `~/.clisbot/clisbot.json`
- env substitution
- agent definitions and default inheritance
- channel routing and policy flags
- topic-aware channel overrides such as Telegram `groups.<chatId>.topics.<threadId>`
- session-key policy
- stale tmux cleanup policy
- runner selection and interaction policy selection
- chat rendering policy, transcript request command configuration, streaming policy, and message update policy
- workspace and operator defaults
- first-run default channel-account bootstrap
- first-run default-agent bootstrap

## Non-Goals

- backend-specific runner code
- channel rendering logic itself

## Related Task Folder

- [docs/tasks/features/configuration](../../tasks/features/configuration)

## Related Test Docs

- [docs/tests/features/configuration](../../tests/features/configuration/README.md)

## Related Research

- [OpenClaw agent and workspace config shape](../../research/configuration/2026-04-06-openclaw-agent-workspace-config-shape.md)
- [OpenClaw template improvements](../../research/configuration/2026-04-10-openclaw-template-improvements.md)

## Supporting Docs

- [Start Bootstrap And Credential Persistence](start-bootstrap-and-credential-persistence.md)

## Dependencies

- [Auth](../auth/README.md)
- [Channels](../channels/README.md)
- [Agents](../agents/README.md)
- [Runners](../runners/README.md)
- [Control](../control/README.md)

## Current Focus

Keep the current local JSON model, but expand it so the system can truthfully express routes, policies, runner choice, default chat rendering, explicit transcript request commands, and the persisted policy inputs used by the auth system.

Current Slack defaults should favor visibility:

- `streaming: "all"`
- `response: "final"`

Current Slack transport rule should favor UX:

- Slack should stream by editing one live bot reply when possible

Current session defaults should favor OpenClaw compatibility:

- `session.mainKey: "main"`
- `session.dmScope: "per-channel-peer"`
- `session.storePath: "~/.clisbot/state/sessions.json"`
- `agents.defaults.workspace: "~/.clisbot/workspaces/{agentId}"`
- `agents.defaults.session.name: "{sessionKey}"`

Current workspace config should stay agent-centric:

- OpenClaw’s current public model is agent-centric: `agents.defaults.workspace` plus per-agent workspace override
- `clisbot` now follows that shape with `agents.defaults.workspace` plus `agents.list[].workspace`
- use the OpenClaw workspace research note before changing this surface again

Current stale tmux cleanup defaults should stay explicit:

- `agents.defaults.session.staleAfterMinutes: 60`
- `control.sessionCleanup.enabled: true`
- `control.sessionCleanup.intervalMinutes: 5`
- `staleAfterMinutes: 0` disables stale cleanup for that agent

Current runner defaults should favor Codex compatibility:

- `runner.sessionId.create.mode: "runner"`
- `runner.sessionId.capture.mode: "status-command"`
- `runner.sessionId.capture.statusCommand: "/status"`
- `runner.sessionId.resume.mode: "command"`

Current turn execution defaults should stay explicit:

- `stream.idleTimeoutMs: 6000`
- `stream.noOutputTimeoutMs: 20000`
- `stream.maxRuntimeMin: 30`

Current session-id ownership rule should stay explicit:

- the agents layer owns the persisted `sessionKey -> sessionId` mapping
- runners own how a concrete backend session id is created, discovered, and resumed

Current tmux naming tradeoff should stay explicit:

- tmux session names are derived from `sessionKey`
- every non-alphanumeric character is normalized to `-`
- names stay readable, but the mapping is not strictly collision-proof

Current Slack route defaults should stay explicit:

- `channelPolicy: "allowlist"`
- `groupPolicy: "allowlist"`
- `directMessages.policy: "pairing"`
- `directMessages.allowFrom: []`
- `directMessages.requireMention: false`
- `verbose: "minimal"`
- `commandPrefixes.slash: ["::", "\\"]`
- `commandPrefixes.bash: ["!"]`
- channel and group routes default to `requireMention: true` unless a route overrides it
- Telegram groups and topics added through the CLI also default to `requireMention: true`

Current auth-model rule:

- routed authorization is owned by `app.auth` and `agents.<id>.auth`
- legacy `privilegeCommands` keys are no longer part of the supported config model
- config loading should reject `privilegeCommands` instead of carrying a compatibility layer

Current sensitive-command rule should stay explicit:

- transcript inspection is controlled by route `verbose`
- `verbose: "minimal"` allows `/transcript`
- `verbose: "off"` blocks `/transcript`
- bash execution is controlled by resolved agent auth through `shellExecute`
- current shell-gated commands are:
  - `/bash <command>`
  - configured bash shortcuts such as `!<command>`
- observer commands such as `/attach`, `/detach`, and `/watch every <duration>` use the normal channel route and do not require `shellExecute`
- transcript visibility is configured under:
  - `channels.slack.verbose`
  - `channels.slack.channels.<id>.verbose`
  - `channels.slack.groups.<id>.verbose`
  - `channels.slack.directMessages.verbose`
  - `channels.telegram.verbose`
  - `channels.telegram.groups.<id>.verbose`
  - `channels.telegram.groups.<id>.topics.<topicId>.verbose`
  - `channels.telegram.directMessages.verbose`
- command shortcut configuration is owned by:
  - `channels.slack.commandPrefixes`
  - `channels.telegram.commandPrefixes`

Current DM access-policy meaning should stay explicit:

- `open`: allow any sender that reaches the DM surface
- `pairing`: deny unknown senders, create or reuse a pairing code, and allow only after approval
- `allowlist`: deny unknown senders without issuing a pairing code
- `disabled`: ignore the DM surface entirely

Current rollout tradeoff should stay explicit:

- OpenClaw treats DM pairing as the secure default
- `clisbot` now matches that default for Slack and Telegram direct messages
- `clisbot` intentionally does not copy OpenClaw's Slack sparse-config fallback to `groupPolicy: "open"`
- `clisbot` keeps explicit `allowlist` defaults for shared Slack and Telegram surfaces

Current first-run startup bootstrap should stay explicit:

- `start` should not bootstrap or launch when neither default Slack nor default Telegram tokens are available
- the default Slack account is defined by `SLACK_APP_TOKEN` plus `SLACK_BOT_TOKEN`
- the default Telegram account is defined by `TELEGRAM_BOT_TOKEN`
- when fresh config is created through `start`, only the channels with available default tokens should be enabled
- fresh config should not auto-add sample Slack channels, Slack groups, Telegram groups, or Telegram topics
- when no agents exist yet and only one supported CLI is installed, `start` should create `default` automatically
- when both `codex` and `claude` are installed, `start` should stop and require an explicit `--cli` choice for the first agent

Current credential-persistence direction should stay explicit:

- fast first-run may accept a literal Telegram token on `start`, but only as an in-memory bootstrap secret
- generated config should prefer account scaffolding plus external secret sources over raw secret persistence
- the preferred durable Telegram path is a canonical credential file under `~/.clisbot/credentials/telegram/<accountId>/bot-token`
- startup and status should explain which credential source is active so canonical path discovery never feels hidden

Current Slack feedback defaults should stay explicit:

- `ackReaction: ""`
- `typingReaction: ""`
- `processingStatus.enabled: true`
- `processingStatus.status: "Working..."`
- `processingStatus.loadingMessages: []`
- the live processing reply remains the durable in-thread processing indicator even when Slack status is unavailable
- reaction writes require Slack bot scope `reactions:write`; if that scope is missing, `clisbot` should keep handling messages and degrade to the live reply indicator only
- assistant thread status currently accepts `chat:write` and still temporarily accepts `assistant:write`; if status writes are unavailable, `clisbot` should keep handling messages and degrade to reactions plus the live reply indicator only

Current Slack continuation target should stay explicit:

- no-mention thread continuation should mean the bot has already replied in that thread
- it should not depend on the bot having authored the thread root
- the exact implementation mechanism can change, but the user-visible rule should stay compatible with latest OpenClaw `main`

Current follow-up config is:

- `channels.slack.followUp.mode: "auto" | "mention-only" | "paused"`
- `channels.slack.followUp.participationTtlMin`
- `channels.slack.followUp.participationTtlSec`
- per-route overrides under `channels.slack.channels.<id>.followUp`
- per-route overrides under `channels.slack.groups.<id>.followUp`
- per-route overrides under `channels.slack.directMessages.followUp`

Future Telegram config should stay OpenClaw-shaped:

- `channels.telegram.botToken`
- `channels.telegram.dmPolicy`
- `channels.telegram.replyToMode`
- `channels.telegram.groups.<chatId>`
- `channels.telegram.groups.<chatId>.topics.<threadId>`
- topic config should inherit parent group config unless the topic overrides it

Current default should stay OpenClaw-compatible:

- `followUp.mode: "auto"`
- `followUp.participationTtlMin: 5`

Current runtime policy state is persisted per `sessionKey` in `session.storePath`:

- `followUp.overrideMode`
- `followUp.lastBotReplyAt`

Current control reload config is:

- `control.configReload.watch`
- `control.configReload.watchDebounceMs`

Current stale cleanup control config is:

- `control.sessionCleanup.enabled`
- `control.sessionCleanup.intervalMinutes`

Current default should stay explicit:

- `control.configReload.watch: false`
- `control.configReload.watchDebounceMs: 250`
- `control.sessionCleanup.enabled: true`
- `control.sessionCleanup.intervalMinutes: 5`

## Sparse Config Rule

`~/.clisbot/clisbot.json` is a sparse config file.

That means:

- the file on disk only contains values you explicitly set
- missing values are filled by runtime defaults when the config is loaded

Do not debug runtime behavior by reading only the sparse file if the behavior depends on defaults.

This is especially important for runner session continuity because `runner.sessionId` may be active even when it is omitted from the file.

## Session-Id Config Guide

Current session-id config lives under:

- `agents.defaults.runner.sessionId`
- `agents.list[].runner.sessionId`

Current fields are:

- `create.mode`
- `create.args`
- `capture.mode`
- `capture.statusCommand`
- `capture.pattern`
- `capture.timeoutMs`
- `capture.pollIntervalMs`
- `resume.mode`
- `resume.command`
- `resume.args`

Current Codex-oriented defaults are:

- `create.mode: "runner"`
- `capture.mode: "status-command"`
- `capture.statusCommand: "/status"`
- `resume.mode: "command"`

Current continuity storage path is:

- `session.storePath`
- default: `~/.clisbot/state/sessions.json`

This file stores the current `sessionKey -> sessionId` mapping used for resume after the tmux session dies.

## DM Access And Pairing Config Guide

Current DM access config lives under:

- `channels.slack.directMessages`
- `channels.telegram.directMessages`

Current fields are:

- `enabled`
- `policy`
- `allowFrom`
- `requireMention`
- `agentId`

Current pairing state path is:

- `~/.clisbot/state/pairing`

Current policy defaults are:

- `policy: "pairing"`
- `allowFrom: []`

Current pairing CLI uses channel-scoped approval:

- `bun run pairing -- list slack`
- `bun run pairing -- approve slack <CODE>`
- `bun run pairing -- list telegram`
- `bun run pairing -- approve telegram <CODE>`

## Stale tmux Cleanup Config Guide

Current stale tmux cleanup config lives under:

- `agents.defaults.session.staleAfterMinutes`
- `agents.list[].session.staleAfterMinutes`
- `control.sessionCleanup.enabled`
- `control.sessionCleanup.intervalMinutes`

Current meaning:

- `staleAfterMinutes`
  - per-agent idle threshold in minutes before clisbot kills the live tmux session
- `staleAfterMinutes: 0`
  - disable stale cleanup for that agent
- `control.sessionCleanup.enabled`
  - enable or disable the background stale-session cleanup loop
- `control.sessionCleanup.intervalMinutes`
  - how often clisbot scans stored sessions for stale tmux runners

Important distinction:

- stale cleanup kills the live tmux session
- stale cleanup does not delete the stored `sessionKey -> sessionId` mapping
- the next inbound turn can still recreate tmux and resume the prior AI CLI session when the runner supports resume
- idle is determined from clisbot session activity timestamps, not from tmux CPU usage
- the cleanup loop skips sessions that are busy in the clisbot queue

## Turn Execution Timeout Guide

Current turn execution timeout config lives under:

- `agents.defaults.stream.idleTimeoutMs`
- `agents.defaults.stream.noOutputTimeoutMs`
- `agents.defaults.stream.maxRuntimeMin`
- `agents.defaults.stream.maxRuntimeSec`
- `agents.list[].stream.*`

Current meaning:

- `idleTimeoutMs`
  - after a turn has already produced visible output, clisbot treats the turn as completed once the runner pane stops changing for this many milliseconds
- `noOutputTimeoutMs`
  - internal diagnostic threshold for turns that have not produced visible activity yet
  - it can be logged or measured, but it does not settle the turn or render a timeout into chat
- `maxRuntimeMin`
  - default minute-based observation window for one turn
  - when that window is exceeded, clisbot stops live follow, leaves the session running, shifts that thread to sparse progress updates, and still posts the final result when it completes
- `maxRuntimeSec`
  - optional second-based observation window when you need a shorter value for tests or special routes

Important distinction:

- these are per-turn execution timers
- they do not control stale tmux cleanup
- stale tmux cleanup is controlled separately by `session.staleAfterMinutes` and `control.sessionCleanup.*`
- a session that was detached after exceeding `maxRuntimeMin` or `maxRuntimeSec` is intentionally exempt from stale cleanup until it is observed again by a later interactive turn or stop action

## Resume Debugging

If runner resume is not working, check:

1. the resolved config is using `capture.mode: "status-command"` and `resume.mode: "command"`
2. the thread-specific tmux session exists on the configured tmux socket
3. `session.storePath` exists and contains the expected `sessionKey`
4. the runner pane responds to `/status` and shows a session id

Important distinction:

- tmux session name is only the live runner handle
- `sessionId` is the tool-native conversation id used for resume
- if tmux dies before a `sessionId` is captured or persisted, the next message starts a fresh tool conversation
