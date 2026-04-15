# Runtime Crash Containment And Service Self-Healing

## Summary

Audit `clisbot` as a long-running remote service and harden the places where one background failure can currently kill the whole runtime or leave Slack or Telegram dead until a human manually restarts it.

## Status

Ready

## Why

`clisbot` is not just a local CLI helper. In production it behaves like a remote service:

- it runs detached for long periods
- it owns stateful Slack and Telegram connections
- it supervises tmux-backed runners
- humans expect it to survive transient faults without manual babysitting

That raises the bar beyond "works on happy path". A single uncaught rejection, silent channel loop exit, or stale health state is enough to make the bot look available while it is actually dead or partially dead.

## Scope

- audit detached-runtime crash paths in `serve-foreground`
- add explicit fatal-event handling for uncaught exceptions and unhandled promise rejections
- remove known unhandled background-task paths
- add post-start channel liveness reporting and restart or self-heal behavior
- make operator health output truthful when one surface dies but the process stays alive
- review state-store read or write paths that can turn file corruption or partial writes into runtime failure
- add regression coverage for the highest-risk failure paths

## Non-Goals

- redesigning the tmux runner architecture from scratch
- distributed HA or multi-instance leader election
- broad feature work unrelated to long-running service survival

## Current Audit Findings

### 1. No process-level fatal-event containment

`serveForeground()` only handles `SIGINT` and `SIGTERM`.

- there is no `uncaughtException` handler
- there is no `unhandledRejection` handler
- there is no last-gasp health transition before exit

Practical consequence:

- any uncaught async failure in a timer, watcher, or background service can terminate the whole detached runtime
- operators then have to notice the outage and run `clisbot start` again manually

Relevant code:

- `src/main.ts`

### 2. Session cleanup timer can produce an unhandled rejection

`AgentService.start()` schedules periodic cleanup with:

- `void this.runnerSessions.runSessionCleanup()`

That callback has no `.catch(...)`, so a transient tmux, fs, or session-store failure can become an unhandled rejection in the live detached process.

Relevant code:

- `src/agents/agent-service.ts`
- `src/agents/runner-session.ts`
- `src/agents/session-store.ts`

### 3. Telegram can stop polling and stay dead without supervisor recovery

`TelegramPollingService.pollLoop()` exits permanently on Telegram polling conflict:

- sets `this.running = false`
- logs the conflict
- returns from the loop

Nothing notifies `RuntimeSupervisor`, nothing marks runtime health as failed, and nothing attempts a bounded restart. The detached process can therefore stay alive while Telegram is already dead.

Relevant code:

- `src/channels/telegram/service.ts`
- `src/control/runtime-supervisor.ts`

### 4. Supervisor only owns startup and reload, not post-start service health

`RuntimeSupervisor` knows how to:

- create services
- start them
- stop them
- reload on config change

But the `ChannelRuntimeService` contract has no way to report:

- runtime death after successful start
- degraded connection state
- restart-needed signals

That means health can remain `active` after the real channel service has already stalled or died.

Relevant code:

- `src/control/runtime-supervisor.ts`
- `src/channels/channel-plugin.ts`
- `src/channels/slack/service.ts`
- `src/channels/telegram/service.ts`

### 5. Some runtime-owned stores are still fragile for service-grade use

There are still store paths where corruption or partial-write scenarios can turn into runtime failure or stale truth:

- `RuntimeHealthStore.read()` does raw `JSON.parse()` with no corruption fallback
- `RuntimeHealthStore.write()` uses direct overwrite, not temp-file rename
- `SessionStore.readStore()` also does raw `JSON.parse()` with no corruption fallback

These files sit on live control paths, so a bad write or bad manual edit should degrade safely instead of taking down the service or blocking status.

Relevant code:

- `src/control/runtime-health-store.ts`
- `src/agents/session-store.ts`
- `src/shared/fs.ts`

## Subtasks

- [ ] add detached-runtime fatal handlers for `uncaughtException` and `unhandledRejection`
- [ ] make fatal handlers mark runtime health and exit with a clear crash reason
- [ ] remove the known unhandled cleanup-timer rejection path
- [ ] extend channel runtime contract so services can emit `failed`, `degraded`, and `recovered` lifecycle events after startup
- [ ] teach `RuntimeSupervisor` to react to those lifecycle events with bounded restart or explicit failed health state
- [ ] harden Telegram polling conflict handling so it updates health truthfully and can recover when appropriate
- [ ] decide the Slack runtime rule for post-start disconnects, reconnects, and permanent failure surfacing
- [ ] make runtime-owned health or session stores corruption-tolerant and atomic where needed
- [ ] add targeted tests for:
  - fatal-event shutdown path
  - cleanup timer failure containment
  - Telegram post-start polling conflict
  - supervisor health transition when a started channel dies

## Exit Criteria

- one background failure no longer silently kills the detached runtime without a recorded reason
- Telegram or Slack cannot die post-start while `clisbot status` still claims everything is healthy
- bounded self-heal or restart behavior exists for channel failures that should recover automatically
- persistent runtime state files fail soft enough that corruption does not become a full service outage by itself
- regression coverage exists for the audited crash and silent-death paths

## Related Docs

- [Stability](../../../features/non-functionals/stability/README.md)
- [Runner Interface Standardization And tmux Runner Hardening](../runners/2026-04-04-runner-interface-standardization-and-tmux-runner-hardening.md)
- [Agents Lifecycle And State Model Hardening](../agents/2026-04-04-agents-lifecycle-and-state-model-hardening.md)
- [Operator Control Surface And Debuggability](../control/2026-04-04-operator-control-surface-and-debuggability.md)
