# User Guide

## Purpose

Use `docs/user-guide/` for operator-facing instructions on how to run, inspect, and troubleshoot `clisbot`.

This folder should explain:

- how to start and inspect the service
- how to interact with the dedicated tmux server
- where runtime state lives
- where channel-specific operating notes live
- how config reload works in practice
- how stale tmux cleanup and sensitive commands work in practice
- how app ownership, roles, and privileged actions are expected to work for operators

Related pages:

- [Channel Operations](channels.md)
- [Channel Accounts](channel-accounts.md)
- [Telegram Bot Setup](telegram-setup.md)
- [Slack App Setup](slack-setup.md)
- [Slash Commands](slash-commands.md)
- [Native CLI Commands](native-cli-commands.md)
- [CLI Commands](cli-commands.md)
- [Agent Progress Replies](agent-progress-replies.md)
- [Authorization And Roles](auth-and-roles.md)

If setup is unclear, clone this repo, open it in Codex or Claude Code, and ask it to help set up `clisbot`. The docs here are kept current enough for guided setup and troubleshooting.

## Service

Default config path:

`~/.clisbot/clisbot.json`

Bootstrap the default config once:

```bash
bun run init
```

Fastest path:

```bash
bun run start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token>
```

After your first successful `clisbot start`:

1. Get your principal from a surface the bot can already see:
   Telegram groups or topics can use `/whoami` even before routing, while DMs with `pairing` policy need pairing first.
2. Grant the first app owner with `clisbot auth add-user app --role owner --user <principal>`.
3. Inspect and tune role permissions with `clisbot auth --help`.
4. Continue with route setup in [Channel Operations](channels.md) and auth details in [Authorization And Roles](auth-and-roles.md).

Persist the token for later plain `clisbot start` runs:

```bash
clisbot start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token> --persist
```

If you use the packaged CLI:

```bash
clisbot start --cli codex --bot-type personal --telegram-bot-token <your-telegram-bot-token> --persist
```

Packaged CLI runtime expects Node 20+.

Start the service in the foreground:

```bash
bun run start
```

Start the packaged CLI in the background:

```bash
npx clisbot start
```

Restart the packaged CLI:

```bash
clisbot restart
```

Stop the packaged CLI:

```bash
clisbot stop
```

Stop the packaged CLI and clean up all tmux sessions on the clisbot socket:

```bash
clisbot stop --hard
```

Start the service in dev mode:

```bash
bun run dev
```

Print the resolved default config path:

```bash
clisbot status
```

Important distinction:

- `clisbot start` seeds `~/.clisbot/clisbot.json` automatically if it does not exist
- `clisbot start` requires Slack or Telegram token references before it bootstraps anything
- when no agents exist yet, `start` requires both `--cli` and `--bot-type` to create the first `default` agent
- `--slack-app-token`, `--slack-bot-token`, and `--telegram-bot-token` accept either bare env names like `CUSTOM_SLACK_APP_TOKEN` or placeholder form like `${CUSTOM_SLACK_APP_TOKEN}`
- `clisbot start` prints which token refs or credential sources it is using for the channels you requested
- existing enabled channel token refs are validated before the detached runtime is spawned
- fresh bootstrap enables only the channels and accounts you named explicitly with flags
- `--persist` writes canonical credential files for any literal channel tokens from that invocation, so later plain `clisbot start` can reuse them
- Gemini-first setups also need Gemini itself to already be authenticated for routed use, either by a prior direct `gemini` login or by headless auth such as `GEMINI_API_KEY` or Vertex AI credentials
- the generated default config does not preseed Slack channel routes, Slack groups, Telegram groups, or Telegram topics
- you must add channel routes manually in `~/.clisbot/clisbot.json`
- `clisbot start` prints a brief agents and channels summary after launch
- `clisbot start` and `clisbot status` print the primary agent workspace before the config path
- that workspace is the default working directory for the agent and contains runtime state, sessions, personality files, and setup guidance
- when no agents exist yet, `clisbot start` prints first-run guidance for direct `start --cli ... --bot-type ...` usage and bootstrap completion
- `clisbot start` runs as a background service and writes runtime pid and log files under `~/.clisbot/state`
- `bun run dev` watches source files in this repo
- `control.configReload.watch` watches the runtime config file
- these are separate mechanisms

## Agents CLI

Use `clisbot agents ...` to manage configured agents and top-level channel bindings.

Current subcommands:

- `clisbot agents list`
- `clisbot agents list --bindings`
- `clisbot agents list --json`
- `clisbot agents add <id> --cli <codex|claude|gemini>`
- `clisbot agents bootstrap <id> --mode <personal-assistant|team-assistant>`
- `clisbot agents bindings`
- `clisbot agents bindings --agent <id>`
- `clisbot agents bind --agent <id> --bind <channel[:accountId]>`
- `clisbot agents unbind --agent <id> --bind <channel[:accountId]>`
- `clisbot agents unbind --agent <id> --all`
- `clisbot agents response-mode status --agent <id>`
- `clisbot agents response-mode set <capture-pane|message-tool> --agent <id>`
- `clisbot agents response-mode clear --agent <id>`
- `clisbot agents additional-message-mode status --agent <id>`
- `clisbot agents additional-message-mode set <queue|steer> --agent <id>`
- `clisbot agents additional-message-mode clear --agent <id>`

Important rules:

- `agents add` requires `--cli`
- supported tools are `codex`, `claude`, and `gemini`
- `--startup-option` may be repeated
- when `--startup-option` is omitted, clisbot uses the built-in startup options for the selected CLI
- public first-run `start` or `init` uses `--bot-type personal|team`; the `agents` CLI below is the lower-level workspace-template surface
- if `--bootstrap` is present, it must be `personal-assistant` or `team-assistant`
- `personal-assistant` fits one assistant for one human
- `team-assistant` fits one shared assistant for a team, channel, or group workflow
- `agents bootstrap` requires `--mode`
- `agents bootstrap` uses the agent's configured CLI tool to decide which tool-specific bootstrap file is required
- `agents bootstrap` runs a dry conflict check first and asks for `--force` before overwriting any template markdown file
- `--bind` may be repeated and currently accepts `slack`, `telegram`, `slack:<accountId>`, or `telegram:<accountId>`
- `agents response-mode` sets or clears `agents.list[].responseMode`
- `agents additional-message-mode` sets or clears `agents.list[].additionalMessageMode`

Examples:

```bash
clisbot agents add work --cli claude --bind telegram
```

```bash
clisbot agents add gem --cli gemini --bootstrap personal-assistant
```

```bash
clisbot agents bind --agent work --bind slack:ops
```

```bash
clisbot agents add ops --cli codex --startup-option --dangerously-skip-permissions --bootstrap team-assistant --bind telegram:ops
```

```bash
clisbot agents bootstrap ops --mode team-assistant --force
```

Binding behavior:

- top-level `bindings` are a fallback route lookup layer
- explicit route `agentId` on a Slack channel, Slack group, Telegram group, or Telegram topic still wins first
- account-specific bindings are accepted in config and CLI now even though current Slack and Telegram runtime routing mostly uses channel-level context

Bootstrap behavior:

- `personal-assistant` and `team-assistant` copy `templates/openclaw`, `templates/customized/default`, and the matching folder under `templates/customized/`
- those internal template modes map to the public first-run choices `--bot-type personal` and `--bot-type team`
- codex bootstrap requires `AGENTS.md` and `IDENTITY.md`
- claude bootstrap requires `CLAUDE.md` and `IDENTITY.md`
- gemini bootstrap requires `GEMINI.md` and `IDENTITY.md`
- bootstrap state is `missing` when the tool-specific file or `IDENTITY.md` is absent
- bootstrap state is `not-bootstrapped` when the required files exist but `BOOTSTRAP.md` is still present
- bootstrap state becomes `bootstrapped` after the required files exist and `BOOTSTRAP.md` is gone
- seeded files include `BOOTSTRAP.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `LOOP.md`, and tool guidance files
- Gemini operational note: `clisbot` can create and route Gemini agents, but the underlying `gemini` CLI still needs direct prior auth or a headless auth path before routed prompts can succeed

Operational note:

- the default generated channel config still points to the `default` agent
- if your first agent uses another id, update `channels.*.defaultAgentId` and any route `agentId` values in `~/.clisbot/clisbot.json`

## Channels CLI

Use `clisbot channels ...` to flip channel enablement in config without editing JSON by hand.

Current subcommands:

- `clisbot channels enable slack`
- `clisbot channels disable slack`
- `clisbot channels enable telegram`
- `clisbot channels disable telegram`
- `clisbot channels add telegram-group <chatId> [--topic <topicId>] [--agent <id>] [--require-mention true|false]`
- `clisbot channels remove telegram-group <chatId> [--topic <topicId>]`
- `clisbot channels add slack-channel <channelId> [--agent <id>] [--require-mention true|false]`
- `clisbot channels remove slack-channel <channelId>`
- `clisbot channels add slack-group <groupId> [--agent <id>] [--require-mention true|false]`
- `clisbot channels remove slack-group <groupId>`
- `clisbot channels set-token <slack-app|slack-bot|telegram-bot> <value>`
- `clisbot channels clear-token <slack-app|slack-bot|telegram-bot>`
- `clisbot channels response-mode status --channel <slack|telegram> [--target <target>] [--topic <topicId>]`
- `clisbot channels response-mode set <capture-pane|message-tool> --channel <slack|telegram> [--target <target>] [--topic <topicId>]`
- `clisbot channels additional-message-mode status --channel <slack|telegram> [--target <target>] [--topic <topicId>]`
- `clisbot channels additional-message-mode set <queue|steer> --channel <slack|telegram> [--target <target>] [--topic <topicId>]`

Important behavior:

- `enable` and `disable` only update `channels.slack.enabled` or `channels.telegram.enabled`
- `add telegram-group` writes `channels.telegram.groups.<chatId>` or `channels.telegram.groups.<chatId>.topics.<topicId>`
- `add slack-channel` writes `channels.slack.channels.<channelId>`
- `add slack-group` writes `channels.slack.groups.<groupId>`
- `set-token` and `clear-token` update the existing channel token fields in config without changing env names elsewhere
- `enable` and `disable` do not inject routes, group mappings, or topic mappings
- `add telegram-group` defaults to `requireMention: true`
- `channels response-mode` uses message-style addressing:
  - Slack targets: `channel:<id>`, `group:<id>`, `dm:<id>`
  - Telegram direct messages: positive chat id
  - Telegram groups: negative chat id
  - Telegram topics: negative chat id plus `--topic <topicId>`
- channel and topic response-mode overrides require the route to exist first
- routed auth now lives in `app.auth` and `agents.<id>.auth`; see [Authorization And Roles](auth-and-roles.md)
- transcript visibility is controlled separately by route-level `verbose`
- conversation-level busy-session tools are available on routed Slack and Telegram conversations:
  - `/queue <message>` or `\q <message>`
  - `/steer <message>` or `\s <message>`
  - `/queue list`
  - `/queue clear`
  - `/nudge`
  - `/loop 5m check CI`
  - `/loop 5m`
  - `/loop 1m --force check deploy`
  - `/loop check deploy every 1m --force`
  - `/loop every day at 07:00 check deploy`
  - `/loop every weekday at 07:00 standup`
  - `/loop every mon at 09:00 weekly review`
  - `/loop 3 /codereview`
  - `/loop 3`
  - `/loop status`
  - `/loop cancel <id>`
- every `/loop` command must include an interval, count, or wall-clock schedule
- if no prompt is supplied after that interval, count, or schedule, clisbot uses the workspace `LOOP.md` file
- bare positive integers in `/loop` mean times mode, compact durations such as `5m` mean interval mode, and `every ... at HH:MM` means wall-clock schedule mode
- interval loops must be at least `1m`
- interval loops below `5m` require `--force`
- with leading interval syntax, place `--force` immediately after the interval token
- with `every ...` syntax, place `--force` immediately after the interval clause
- wall-clock schedules must use `HH:MM` in 24-hour format and wait until the next matching local time instead of firing immediately
- wall-clock schedules resolve timezone from route override first, then `control.loop.defaultTimezone`, then host timezone
- managed loops are created with ids, bounded by `control.loop.maxRunsPerLoop`, and capped globally by `control.loop.maxActiveLoops`
- managed loops use `skip-if-busy`, so a tick is dropped instead of stacking more queued work when the session is already busy
- managed loops persist in session state and are restored after restart
- `/stop` interrupts the current run only; use `/loop cancel` to cancel loops
- `/nudge` sends one extra `Enter` to the current tmux session without resending the prompt body; use it only as a manual recovery tool when a session seems stuck after input delivery

Timezone config examples:

```json
{
  "control": {
    "loop": {
      "maxRunsPerLoop": 20,
      "maxActiveLoops": 10,
      "defaultTimezone": "Asia/Ho_Chi_Minh"
    }
  }
}
```

```json
{
  "channels": {
    "telegram": {
      "groups": {
        "-1001234567890": {
          "timezone": "Asia/Ho_Chi_Minh",
          "topics": {
            "4": {
              "timezone": "America/Los_Angeles"
            }
          }
        }
      }
    }
  }
}
```

- route `timezone` overrides `control.loop.defaultTimezone`
- once a wall-clock loop is created, its effective timezone is persisted on that loop record
- if the service is already running, restart it after changing channel enablement
- `clisbot channels` and `clisbot channels --help` print setup guidance for Slack ids, Telegram group or topic ids, allowlists, and routed auth docs

## Loops CLI

Use `clisbot loops ...` to inspect or cancel recurring loops that were already created through channel `/loop` commands.

Current subcommands:

- `clisbot loops list`
- `clisbot loops status`
- `clisbot loops cancel <id>`
- `clisbot loops cancel --all`

Important behavior:

- `list` and `status` are aliases and print the same global inventory
- this CLI does not create loops
- every row includes `agentId` and `sessionKey` because the operator CLI is app-wide rather than route-scoped
- `cancel --all` is app-wide
- loop state is read from `session.storePath`, which defaults to `~/.clisbot/state/sessions.json`
- if `CLISBOT_HOME` is set, the default session store becomes `<CLISBOT_HOME>/state/sessions.json`
- the runtime scheduler re-checks persisted loop state before each scheduled tick, so cancelling through the CLI suppresses future runs without adding a separate control socket
- cancelling through the CLI does not interrupt an iteration that is already running

## Start And Status Output

`clisbot start` now prints an operator summary after startup.

What it includes:

- configured agents with tool, bootstrap state, bindings, and last activity
- configured Slack and Telegram channel summaries with connection state and last activity
- first-run guidance when no agents are configured
- bootstrap follow-up guidance when an agent workspace is `missing` or `not-bootstrapped`
- direct next steps for `clisbot --help` and the user guide when no agents are configured
- channel-specific token checks such as `Slack channel: found token...` or `Telegram channel: token not found...`
- the same operator help even when the service is already running

## Custom Token References

If your shell uses different environment variable names, pass them directly on first run:

```bash
clisbot start \
  --cli codex \
  --bot-type personal \
  --slack-app-token CUSTOM_SLACK_APP_TOKEN \
  --slack-bot-token CUSTOM_SLACK_BOT_TOKEN
```

Or for Telegram:

```bash
clisbot start \
  --cli claude \
  --bot-type team \
  --telegram-bot-token CUSTOM_TELEGRAM_BOT_TOKEN
```

Important behavior:

- these values are written into `~/.clisbot/clisbot.json` as `${ENV_NAME}` placeholders
- bare env names are normalized into `${ENV_NAME}` placeholders in config
- `clisbot` does not resolve or print the secret value during config bootstrap
- this is meant for env variable names you chose, not raw secret literals
- if you still prefer manual setup, `clisbot init` accepts the same `--cli`, `--bot-type`, and token-reference flags as `clisbot start`, but it does not start the runtime

`clisbot status` now prints:

- process status, pid, config path, log path, and tmux socket
- aggregate stats for agents, bootstrapped agents, pending bootstrap agents, and running tmux sessions
- per-agent last activity
- per-channel last activity and effective connection state
- active runtime channel identity when available, such as account id, bot label, app id, and a short token fingerprint

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
  - once a turn has already produced visible output, clisbot treats it as completed after 6 seconds with no pane changes
- `noOutputTimeoutMs: 20000`
  - if a turn produces no visible output for 20 seconds from the start, clisbot returns a timeout
- `maxRuntimeMin: 15`
  - default observation window of 15 minutes for one turn
  - if the session is still active after that window, clisbot stops waiting, leaves the session running, and tells you to use `/attach` or `/watch every 30s` to inspect it later
- `maxRuntimeSec`
  - optional second-based observation window when you need tighter tests or shorter limits

Important distinction:

- these settings affect streaming settlement and turn completion
- they do not decide whether the tmux session stays alive after the turn
- stale tmux cleanup is controlled separately by `session.staleAfterMinutes` and `control.sessionCleanup.*`
- a detached long-running session is exempt from stale cleanup until a later interactive turn or stop action clears that detached state

## Long-Running Session Commands

When a run keeps going beyond the initial observation window, `clisbot` keeps monitoring it and can keep this thread attached in different ways.

Current commands:

- `/attach`
  - attach this thread to the active run
  - if the run is still processing, live updates resume here
  - if the run is already settled, you get one latest settled state
- `/detach`
  - stop live updates for this thread
  - the underlying run keeps going
  - final settlement is still posted here when the run completes
- `/watch every 30s`
  - post the latest state here every 30 seconds until the run completes
- `/watch every 30s for 10m`
  - same as above, but stop interval watch after the configured window

Current prompt-admission rule:

- if a session already has an active run, a new prompt is rejected until that run settles or is interrupted
- use `/attach`, `/watch`, or `/stop` instead of sending a second prompt into the same still-running session

Current observer-scope rule:

- observer mode is currently scoped per thread for a routed conversation
- running `/attach` or `/watch ...` again in the same thread replaces the earlier observer mode for that same thread

Current status visibility:

- `/status` now shows whether the routed session is `idle`, `running`, or `detached`
- when available, `/status` also shows `run.startedAt` and `run.detachedAt`
- `clisbot status` now lists active runs too, so detached autonomous sessions are visible without using `/transcript` or re-attaching a thread

## clisbot tmux Server

`clisbot` does not use your default tmux server.

It starts and manages its own tmux server through a dedicated socket:

`~/.clisbot/state/clisbot.sock`

That means normal tmux commands such as `tmux list-sessions` will not show the sessions created by `clisbot`.

Use the socket-aware commands below instead.

## Common Commands

List sessions managed by `clisbot`:

```bash
tmux -S ~/.clisbot/state/clisbot.sock list-sessions
```

Attach to the default agent session:

```bash
tmux -S ~/.clisbot/state/clisbot.sock attach-session -t <session-name>
```

Kill the default agent session:

```bash
tmux -S ~/.clisbot/state/clisbot.sock kill-session -t <session-name>
```

Kill the entire `clisbot` tmux server:

```bash
tmux -S ~/.clisbot/state/clisbot.sock kill-server
```

## Runtime State

Important runtime paths:

- config: `~/.clisbot/clisbot.json`
- tmux socket: `~/.clisbot/state/clisbot.sock`
- runtime pid: `~/.clisbot/state/clisbot.pid`
- runtime log: `~/.clisbot/state/clisbot.log`
- session store: `~/.clisbot/state/sessions.json`
- activity store: `~/.clisbot/state/activity.json`
- pairing store: `~/.clisbot/state/pairing`

Useful checks:

```bash
tmux -S ~/.clisbot/state/clisbot.sock list-sessions
```

```bash
tmux -S ~/.clisbot/state/clisbot.sock attach -t agent-default-main
```

```bash
cat ~/.clisbot/state/sessions.json
```

```bash
cat ~/.clisbot/state/activity.json
```

```bash
ls -la ~/.clisbot/state/pairing
```

```bash
tail -f ~/.clisbot/state/clisbot.log
```

Codex trust prompt troubleshooting:

- clisbot already keeps `trustWorkspace: true` by default for Codex
- if Codex still shows `Do you trust the contents of this directory?`, also mark the clisbot workspace as trusted in `~/.codex/config.toml`

Example:

```toml
[projects."/home/node/.clisbot/workspaces/default"]
trust_level = "trusted"
```

- if the trust screen is still visible, attach to the tmux session and continue from there:

```bash
tmux -S ~/.clisbot/state/clisbot.sock attach -t agent-default-main
```

- if Codex warns that `bubblewrap` is missing on Linux, install `bubblewrap` in the runtime environment

Inside each agent workspace, inbound channel files are stored under:

- `{workspace}/.attachments/{sessionKey}/{messageId}/...`

Current prompt behavior is minimal:

- `clisbot` prepends `@/absolute/path` mentions for stored files
- then it appends the user message text

## Stale tmux Cleanup

clisbot can reclaim idle tmux sessions without resetting the logical conversation.

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
- it does not delete the stored `sessionKey -> sessionId` mapping in `~/.clisbot/state/sessions.json`
- the next message on the same conversation can recreate tmux and resume the prior AI CLI session when the runner supports resume
- idle is determined from clisbot session activity, not from tmux CPU or pane movement directly
- the cleanup loop skips sessions that are currently busy in the clisbot queue
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
2. confirm the tmux session exists on `~/.clisbot/state/clisbot.sock`
3. wait past the configured stale threshold
4. confirm the session disappears from `tmux list-sessions` on that socket
5. send another prompt in the same channel or thread
6. confirm the conversation resumes instead of resetting when the runner supports `sessionId` resume

## Config Reload

Config reload is controlled by:

- `control.configReload.watch`
- `control.configReload.watchDebounceMs`

Meaning:

- `watch: true` enables file watching for `~/.clisbot/clisbot.json`
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

- saving `~/.clisbot/clisbot.json` should trigger an in-process reload
- the service should log `clisbot reloaded config ...`
- later Slack messages should use the new config without a manual restart

Safe way to verify:

1. change a visible Slack setting such as `channels.slack.ackReaction`
2. save the config file
3. confirm the reload log appears
4. send a Slack test message
5. confirm the new reaction or behavior is visible

Runtime follow-up state is stored per `sessionKey` in:

`~/.clisbot/state/sessions.json`

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

- the default workspace for agent `default` is `~/.clisbot/workspaces/default`
- tmux session names now derive from session keys, so one agent can have multiple tmux sessions at once
- the default session name template is `agents.defaults.session.name = "{sessionKey}"`
- tmux session names are created by normalizing the rendered value into a tmux-safe name, replacing every non-alphanumeric character with `-`
- list sessions first, then attach to the specific one you want
- if the Codex trust screen appears stale after attaching, press `Ctrl-L` inside the tmux session to redraw the pane
