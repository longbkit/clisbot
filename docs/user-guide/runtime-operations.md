# Runtime Operations

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
- monitor pid: `~/.clisbot/state/clisbot.pid`
- monitor state: `~/.clisbot/state/clisbot-monitor.json`
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

## Runtime Monitor

Detached `clisbot start` now runs under an app-owned runtime monitor.

Current behavior:

- `clisbot.pid` belongs to the monitor process
- `clisbot status` shows monitor state, current runtime pid when one is active, and `next restart` when the service is in backoff
- if the runtime worker crashes repeatedly, the monitor retries with bounded backoff instead of requiring an immediate manual restart
- if the monitor finds a stale worker without a live monitor, `stop` and the next `start` clean that worker up before continuing

Current config points:

- `control.runtimeMonitor.restartBackoff.fastRetry.delaySeconds`
- `control.runtimeMonitor.restartBackoff.fastRetry.maxRestarts`
- `control.runtimeMonitor.restartBackoff.stages[].delayMinutes`
- `control.runtimeMonitor.restartBackoff.stages[].maxRestarts`
- `control.runtimeMonitor.ownerAlerts.enabled`
- `control.runtimeMonitor.ownerAlerts.minIntervalMinutes`

Current default policy:

- retry every 10 seconds for the first 3 unexpected exits
- restart every 15 minutes for the first 4 retries
- then every 30 minutes for the next 4 retries
- then stop and require an operator restart after the root cause is fixed

Current owner alert rule:

- if `app.auth.roles.owner.users` contains reachable principals, the monitor sends a direct alert when the service first enters restart backoff
- it sends another direct alert when the configured restart budget is exhausted
- same-kind alerts are rate-limited by `control.runtimeMonitor.ownerAlerts.minIntervalMinutes`

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
