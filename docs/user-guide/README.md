# User Guide

## Purpose

Use `docs/user-guide/` for operator-facing instructions on how to run, inspect, and troubleshoot `muxbot`.

This folder should explain:

- how to start and inspect the service
- how to interact with the dedicated tmux server
- where runtime state lives
- where channel-specific operating notes live
- how config reload works in practice
- how stale tmux cleanup and sensitive commands work in practice

Related pages:

- [Channel Operations](channels.md)
- [Channel Accounts](channel-accounts.md)

If setup is unclear, clone this repo, open it in Codex or Claude Code, and ask it to help set up `muxbot`. The docs here are kept current enough for guided setup and troubleshooting.

If you are still in doubt after reading this guide, clone `https://github.com/longbkit/muxbot`, open the repo in Codex or Claude Code, and ask for setup help directly in the repo context.

## Service

Default config path:

`~/.muxbot/muxbot.json`

Bootstrap the default config once:

```bash
bun run init
```

Fastest path:

```bash
bun run start --cli codex --bootstrap personal-assistant
```

If you use the packaged CLI:

```bash
muxbot start --cli codex --bootstrap personal-assistant
```

Start the service in the foreground:

```bash
bun run start
```

Start the packaged CLI in the background:

```bash
npx muxbot start
```

Restart the packaged CLI:

```bash
muxbot restart
```

Stop the packaged CLI:

```bash
muxbot stop
```

Stop the packaged CLI and clean up all tmux sessions on the muxbot socket:

```bash
muxbot stop --hard
```

Start the service in dev mode:

```bash
bun run dev
```

Print the resolved default config path:

```bash
bun run src/main.ts status
```

Important distinction:

- `muxbot start` seeds `~/.muxbot/muxbot.json` automatically if it does not exist
- `muxbot start` requires Slack or Telegram token references before it bootstraps anything
- when no agents exist yet, `start` requires both `--cli` and `--bootstrap` to create the first `default` agent
- `--slack-app-token`, `--slack-bot-token`, and `--telegram-bot-token` accept either bare env names like `CUSTOM_SLACK_APP_TOKEN` or placeholder form like `${CUSTOM_SLACK_APP_TOKEN}`
- `muxbot start` prints which token env names it checks and whether each one is set or missing
- existing enabled channel token refs are validated before the detached runtime is spawned
- the generated default config enables only the channels that have default tokens available
- if default Slack or Telegram tokens exist later but the existing config still keeps that channel disabled, `muxbot start` prints the exact env names and a quick enable command
- the generated default config does not preseed Slack channel routes, Slack groups, Telegram groups, or Telegram topics
- you must add channel routes manually in `~/.muxbot/muxbot.json`
- `muxbot start` prints a brief agents and channels summary after launch
- `muxbot start` and `muxbot status` print the primary agent workspace before the config path
- that workspace is the default working directory for the agent and contains runtime state, sessions, personality files, and setup guidance
- when no agents exist yet, `muxbot start` prints first-run guidance for direct `start --cli ... --bootstrap ...` usage and bootstrap completion
- `muxbot start` runs as a background service and writes runtime pid and log files under `~/.muxbot/state`
- `bun run dev` watches source files in this repo
- `control.configReload.watch` watches the runtime config file
- these are separate mechanisms

## Agents CLI

Use `muxbot agents ...` to manage configured agents and top-level channel bindings.

Current subcommands:

- `muxbot agents list`
- `muxbot agents list --bindings`
- `muxbot agents list --json`
- `muxbot agents add <id> --cli <codex|claude>`
- `muxbot agents bootstrap <id> --mode <personal-assistant|team-assistant>`
- `muxbot agents bindings`
- `muxbot agents bindings --agent <id>`
- `muxbot agents bind --agent <id> --bind <channel[:accountId]>`
- `muxbot agents unbind --agent <id> --bind <channel[:accountId]>`
- `muxbot agents unbind --agent <id> --all`

Important rules:

- `agents add` requires `--cli`
- supported tools are `codex` and `claude`
- `--startup-option` may be repeated
- when `--startup-option` is omitted, muxbot uses the built-in startup options for the selected CLI
- if `--bootstrap` is present, it must be `personal-assistant` or `team-assistant`
- `personal-assistant` fits one assistant for one human
- `team-assistant` fits one shared assistant for a team, channel, or group workflow
- `agents bootstrap` requires `--mode`
- `agents bootstrap` uses the agent's configured CLI tool to decide which tool-specific bootstrap file is required
- `agents bootstrap` runs a dry conflict check first and asks for `--force` before overwriting any template markdown file
- `--bind` may be repeated and currently accepts `slack`, `telegram`, `slack:<accountId>`, or `telegram:<accountId>`

Examples:

```bash
muxbot agents add default --cli codex --bootstrap personal-assistant
```

```bash
muxbot agents add work --cli claude --startup-option --dangerously-skip-permissions --bootstrap team-assistant --bind telegram
```

```bash
muxbot agents bind --agent work --bind slack:ops
```

```bash
muxbot agents bootstrap work --mode team-assistant --force
```

Binding behavior:

- top-level `bindings` are a fallback route lookup layer
- explicit route `agentId` on a Slack channel, Slack group, Telegram group, or Telegram topic still wins first
- account-specific bindings are accepted in config and CLI now even though current Slack and Telegram runtime routing mostly uses channel-level context

Bootstrap behavior:

- `personal-assistant` and `team-assistant` copy `templates/openclaw` plus the matching folder under `templates/customized/`
- codex bootstrap requires `AGENTS.md` and `IDENTITY.md`
- claude bootstrap requires `CLAUDE.md` and `IDENTITY.md`
- bootstrap state is `missing` when the tool-specific file or `IDENTITY.md` is absent
- bootstrap state is `not-bootstrapped` when the required files exist but `BOOTSTRAP.md` is still present
- bootstrap state becomes `bootstrapped` after the required files exist and `BOOTSTRAP.md` is gone
- seeded files typically include `BOOTSTRAP.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, and tool guidance files

Operational note:

- the default generated channel config still points to the `default` agent
- if your first agent uses another id, update `channels.*.defaultAgentId` and any route `agentId` values in `~/.muxbot/muxbot.json`

## Channels CLI

Use `muxbot channels ...` to flip channel enablement in config without editing JSON by hand.

Current subcommands:

- `muxbot channels enable slack`
- `muxbot channels disable slack`
- `muxbot channels enable telegram`
- `muxbot channels disable telegram`
- `muxbot channels add telegram-group <chatId> [--topic <topicId>] [--agent <id>] [--require-mention true|false]`
- `muxbot channels remove telegram-group <chatId> [--topic <topicId>]`
- `muxbot channels add slack-channel <channelId> [--agent <id>] [--require-mention true|false]`
- `muxbot channels remove slack-channel <channelId>`
- `muxbot channels add slack-group <groupId> [--agent <id>] [--require-mention true|false]`
- `muxbot channels remove slack-group <groupId>`
- `muxbot channels set-token <slack-app|slack-bot|telegram-bot> <value>`
- `muxbot channels clear-token <slack-app|slack-bot|telegram-bot>`
- `muxbot channels privilege enable <target>`
- `muxbot channels privilege disable <target>`
- `muxbot channels privilege allow-user <target> <userId>`
- `muxbot channels privilege remove-user <target> <userId>`

Important behavior:

- `enable` and `disable` only update `channels.slack.enabled` or `channels.telegram.enabled`
- `add telegram-group` writes `channels.telegram.groups.<chatId>` or `channels.telegram.groups.<chatId>.topics.<topicId>`
- `add slack-channel` writes `channels.slack.channels.<channelId>`
- `add slack-group` writes `channels.slack.groups.<groupId>`
- `set-token` and `clear-token` update the existing channel token fields in config without changing env names elsewhere
- `enable` and `disable` do not inject routes, group mappings, or topic mappings
- `add telegram-group` defaults to `requireMention: true`
- `privilege` commands update route-level `privilegeCommands.enabled` and `privilegeCommands.allowUsers`
- direct-message privilege targets are literal command targets: `slack-dm` and `telegram-dm`
- if the service is already running, restart it after changing channel enablement
- `muxbot channels` and `muxbot channels --help` print setup guidance for Slack ids, Telegram group or topic ids, allowlists, and privilege commands

## Start And Status Output

`muxbot start` now prints an operator summary after startup.

What it includes:

- configured agents with tool, bootstrap state, bindings, and last activity
- configured Slack and Telegram channel summaries with connection state and last activity
- first-run guidance when no agents are configured
- bootstrap follow-up guidance when an agent workspace is `missing` or `not-bootstrapped`
- direct next steps for `muxbot --help` and the user guide when no agents are configured
- channel-specific token checks such as `Slack channel: found token...` or `Telegram channel: token not found...`
- the same operator help even when the service is already running

## Custom Token References

If your shell uses different environment variable names, pass them directly on first run:

```bash
muxbot start \
  --cli codex \
  --bootstrap personal-assistant \
  --slack-app-token CUSTOM_SLACK_APP_TOKEN \
  --slack-bot-token CUSTOM_SLACK_BOT_TOKEN
```

Or for Telegram:

```bash
muxbot start \
  --cli claude \
  --bootstrap team-assistant \
  --telegram-bot-token CUSTOM_TELEGRAM_BOT_TOKEN
```

Important behavior:

- these values are written into `~/.muxbot/muxbot.json` exactly as provided
- bare env names are normalized into `${ENV_NAME}` placeholders in config
- `muxbot` does not resolve or print the secret value during config bootstrap
- this is meant for custom env variable names, not raw secret literals
- if you still prefer manual setup, `muxbot init` accepts the same `--cli`, `--bootstrap`, and token-reference flags as `muxbot start`, but it does not start the runtime

`muxbot status` now prints:

- process status, pid, config path, log path, and tmux socket
- aggregate stats for agents, bootstrapped agents, pending bootstrap agents, and running tmux sessions
- per-agent last activity
- per-channel last activity and effective connection state

Connection state meaning:

- `active`: channel is enabled and the runtime process is running
- `stopped`: channel is enabled in config but the runtime process is not running
- `disabled`: channel is turned off in config

## Turn Execution Timeouts

These settings control one prompt turn, not long-term tmux session cleanup.

Current config points are:

- `agents.defaults.stream.idleTimeoutMs`
- `agents.defaults.stream.noOutputTimeoutMs`
- `agents.defaults.stream.maxRuntimeMin`
- `agents.defaults.stream.maxRuntimeSec`
- `agents.list[].stream.*`

Current meaning:

- `idleTimeoutMs: 6000`
  - once a turn has already produced visible output, muxbot treats it as completed after 6 seconds with no pane changes
- `noOutputTimeoutMs: 20000`
  - if a turn produces no visible output for 20 seconds from the start, muxbot returns a timeout
- `maxRuntimeMin: 15`
  - hard cap of 15 minutes for one turn by default
- `maxRuntimeSec`
  - optional second-based override when you need tighter tests or shorter limits

Important distinction:

- these settings affect streaming settlement and turn completion
- they do not decide whether the tmux session stays alive after the turn
- stale tmux cleanup is controlled separately by `session.staleAfterMinutes` and `control.sessionCleanup.*`

## muxbot tmux Server

`muxbot` does not use your default tmux server.

It starts and manages its own tmux server through a dedicated socket:

`~/.muxbot/state/muxbot.sock`

That means normal tmux commands such as `tmux list-sessions` will not show the sessions created by `muxbot`.

Use the socket-aware commands below instead.

## Common Commands

List sessions managed by `muxbot`:

```bash
tmux -S ~/.muxbot/state/muxbot.sock list-sessions
```

Attach to the default agent session:

```bash
tmux -S ~/.muxbot/state/muxbot.sock attach-session -t <session-name>
```

Kill the default agent session:

```bash
tmux -S ~/.muxbot/state/muxbot.sock kill-session -t <session-name>
```

Kill the entire `muxbot` tmux server:

```bash
tmux -S ~/.muxbot/state/muxbot.sock kill-server
```

## Runtime State

Important runtime paths:

- config: `~/.muxbot/muxbot.json`
- tmux socket: `~/.muxbot/state/muxbot.sock`
- runtime pid: `~/.muxbot/state/muxbot.pid`
- runtime log: `~/.muxbot/state/muxbot.log`
- session store: `~/.muxbot/state/sessions.json`
- activity store: `~/.muxbot/state/activity.json`
- pairing store: `~/.muxbot/state/pairing`

Useful checks:

```bash
tmux -S ~/.muxbot/state/muxbot.sock list-sessions
```

```bash
cat ~/.muxbot/state/sessions.json
```

```bash
cat ~/.muxbot/state/activity.json
```

```bash
ls -la ~/.muxbot/state/pairing
```

```bash
tail -f ~/.muxbot/state/muxbot.log
```

Inside each agent workspace, inbound channel files are stored under:

- `{workspace}/.attachments/{sessionKey}/{messageId}/...`

Current prompt behavior is minimal:

- `muxbot` prepends `@/absolute/path` mentions for stored files
- then it appends the user message text

## Stale tmux Cleanup

muxbot can reclaim idle tmux sessions without resetting the logical conversation.

Current config points are:

- `agents.defaults.session.staleAfterMinutes`
- `agents.list[].session.staleAfterMinutes`
- `control.sessionCleanup.enabled`
- `control.sessionCleanup.intervalMinutes`

Current meaning:

- `staleAfterMinutes: 60`
  - kill a live tmux runner after 60 idle minutes
- `staleAfterMinutes: 0`
  - disable stale cleanup for that agent
- `control.sessionCleanup.intervalMinutes: 5`
  - scan every 5 minutes for stale tmux runners

Important rule:

- stale cleanup kills the live tmux session only
- it does not delete the stored `sessionKey -> sessionId` mapping in `~/.muxbot/state/sessions.json`
- the next message on the same conversation can recreate tmux and resume the prior AI CLI session when the runner supports resume
- idle is determined from muxbot session activity, not from tmux CPU or pane movement directly
- the cleanup loop skips sessions that are currently busy in the muxbot queue
- one old user message does not make a still-busy active run look stale

Example:

```json
{
  "agents": {
    "defaults": {
      "session": {
        "createIfMissing": true,
        "staleAfterMinutes": 60
      }
    }
  },
  "control": {
    "sessionCleanup": {
      "enabled": true,
      "intervalMinutes": 5
    }
  }
}
```

How to verify:

1. send one prompt so the conversation creates a tmux session
2. confirm the tmux session exists on `~/.muxbot/state/muxbot.sock`
3. wait past the configured stale threshold
4. confirm the session disappears from `tmux list-sessions` on that socket
5. send another prompt in the same channel or thread
6. confirm the conversation resumes instead of resetting when the runner supports `sessionId` resume

## Config Reload

Config reload is controlled by:

- `control.configReload.watch`
- `control.configReload.watchDebounceMs`

Meaning:

- `watch: true` enables file watching for `~/.muxbot/muxbot.json`
- `watchDebounceMs` delays reload slightly so one save operation does not trigger multiple reloads

Important rule:

- if watch is currently off, changing the file to turn watch on still needs one manual restart because there is no watcher yet
- once watch is on, later config saves should reload automatically

Example:

```json
{
  "control": {
    "configReload": {
      "watch": true,
      "watchDebounceMs": 250
    }
  }
}
```

Operational behavior:

- saving `~/.muxbot/muxbot.json` should trigger an in-process reload
- the service should log `muxbot reloaded config ...`
- later Slack messages should use the new config without a manual restart

Safe way to verify:

1. change a visible Slack setting such as `channels.slack.ackReaction`
2. save the config file
3. confirm the reload log appears
4. send a Slack test message
5. confirm the new reaction or behavior is visible

Runtime follow-up state is stored per `sessionKey` in:

`~/.muxbot/state/sessions.json`

Useful fields are:

- `sessionId`
- `followUp.overrideMode`
- `followUp.lastBotReplyAt`
- `updatedAt`

Current default follow-up window is 5 minutes:

- `channels.slack.followUp.participationTtlMin: 5`
- `channels.telegram.followUp.participationTtlMin: 5`

Optional second-based tuning is also supported:

- `channels.slack.followUp.participationTtlSec`
- `channels.telegram.followUp.participationTtlSec`

## Notes

- the default workspace for agent `default` is `~/.muxbot/workspaces/default`
- tmux session names now derive from session keys, so one agent can have multiple tmux sessions at once
- the default session name template is `agents.defaults.session.name = "{sessionKey}"`
- tmux session names are created by normalizing the rendered value into a tmux-safe name, replacing every non-alphanumeric character with `-`
- list sessions first, then attach to the specific one you want
- if the Codex trust screen appears stale after attaching, press `Ctrl-L` inside the tmux session to redraw the pane
