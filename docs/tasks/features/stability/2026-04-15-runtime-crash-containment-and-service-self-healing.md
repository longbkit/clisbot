# Runtime Crash Containment And Service Self-Healing

## Summary

Audit `clisbot` as a long-running remote service and harden the places where one background failure can currently kill the whole runtime or leave Slack or Telegram dead until a human manually restarts it.

## Status

In Progress

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

### 1. Fatal-event containment was the original gap, and is now shipped

This was a real gap when the task started:

- `serveForeground()` only handled `SIGINT` and `SIGTERM`
- there was no `uncaughtException` handler
- there was no `unhandledRejection` handler
- there was no last-gasp health transition before exit

That part is now implemented:

- detached runtime now installs fatal handlers for `uncaughtException` and `unhandledRejection`
- fatal shutdown now records channel health as `failed` before exit instead of disappearing silently
- bounded restart now comes from the runtime monitor layer after worker exit

Relevant code:

- `src/control/runtime-management-cli.ts`
- `src/control/runtime-monitor.ts`

### 2. Session cleanup rejection containment was the original gap, and is now shipped

This was also a real gap when the task started:

- `AgentService.start()` scheduled periodic cleanup with `void this.runnerSessions.runSessionCleanup()`
- that callback had no `.catch(...)`
- a transient tmux, fs, or session-store fault could therefore become an unhandled rejection

That path is now contained:

- session cleanup failures are caught and logged
- they no longer escape as an unhandled rejection that can kill the detached runtime

Relevant code:

- `src/agents/agent-service.ts`
- `src/agents/runner-service.ts`
- `src/agents/session-store.ts`

### 3. Telegram post-start polling failure was the original gap, and is now shipped

This was another real gap when the task started:

- `TelegramPollingService.pollLoop()` could exit permanently on polling conflict
- the process stayed alive
- Telegram could therefore be dead while operator status still looked healthy

That specific path is now much better:

- Telegram post-start polling conflict now reports lifecycle failure up to the supervisor
- runtime health is marked failed for that channel instead of staying falsely active
- the process-level monitor can then apply bounded restart if the worker exits

Relevant code:

- `src/channels/telegram/service.ts`
- `src/control/runtime-supervisor.ts`

### 4. Post-start lifecycle reporting now exists, but only part of the wider problem is solved

This task originally found that the supervisor only really owned startup and reload.

That is no longer fully true:

- `ChannelRuntimeService` now has a lifecycle callback path
- `RuntimeSupervisor.reportChannelLifecycle()` can update health after startup

But this area is still only partially hardened:

- Telegram failure after startup is covered
- broader degradation or restart-needed signals are still not modeled consistently across all services
- the contract still only reports `active` or `failed`, not a richer degraded or restart-needed state

Relevant code:

- `src/control/runtime-supervisor.ts`
- `src/channels/channel-plugin.ts`
- `src/channels/slack/service.ts`
- `src/channels/telegram/service.ts`

### 5. Runtime-owned state files are still only partially hardened

There are still store paths where corruption or partial-write scenarios can turn into runtime failure or stale truth:

- `RuntimeHealthStore.read()` does raw `JSON.parse()` with no corruption fallback
- `RuntimeHealthStore.write()` uses direct overwrite, not temp-file rename
- `SessionStore.readStore()` still does raw `JSON.parse()` with no corruption fallback

Important nuance:

- `SessionStore.writeStore()` is already better because it now writes through temp-file rename
- but the read path is still fragile
- `RuntimeHealthStore` is still fragile on both read and write

This means the task is not blocked on zero progress here. It is blocked on finishing the hardening consistently.

Relevant code:

- `src/control/runtime-health-store.ts`
- `src/agents/session-store.ts`
- `src/shared/fs.ts`

### 6. In-flight runner-session loss now has bounded recovery, but terminal rendering still needs cleanup

The mid-prompt recovery gap is no longer the old asymmetric failure path.

- startup and pre-prompt session loss still recover in `RunnerService`
- mid-prompt tmux session loss now follows a bounded two-step flow:
  - first try reopening the same conversation context with the stored `sessionId`
  - on a successful reopen, the same run now immediately sends `continue exactly where you left off` before any queued follow-up can run
  - same-context reopen is now retried up to `2` times before falling through
  - if same-context recovery is unavailable and no stored resumable session id exists, open a fresh session without replaying the old prompt
  - if a stored resumable session id exists but cannot be reopened, preserve the mapping and fail truthfully; `/new` is the explicit rotation path
  - fail the current run truthfully and tell the user to resend the full prompt or context
- recovery notes are now forced visible in-channel even when route `streaming` is `off`
- channel-facing error rendering still adds noise today:
  - Slack appends `_Error._`
  - Telegram appends `Error.`
  even when the real error message is already complete

Practical consequence:

- if tmux dies while an in-memory active run is still monitored, the monitor owns recovery and should not be bypassed by admission-time cleanup
- if only persisted `running` or `detached` runtime remains and the tmux session is gone, that projection is stale and should be cleared to `idle` before the next prompt starts
- `runner list` remains a live-runner debug surface; stale persisted runtime belongs in status/debug output, not in the live runner list

- a transient tmux or runner-session drop mid-prompt can now self-heal when same-context reopen succeeds
- if only a fresh session can be opened, the current run still fails truthfully instead of pretending the old context survived
- if a stored native session id exists but cannot be reopened, clisbot preserves that mapping and tells the operator to use `/new` when they intentionally want a new native conversation
- the final message is noisier than it should be and can look sloppy or misleading

Resilience requirement:

- fail-soft behavior is not the target by itself
- the target is bounded self-recovery first
- only after recovery is exhausted should the system degrade to an explicit, truthful failure for that affected run or surface

Relevant code:

- `src/agents/session-service.ts`
- `src/agents/runner-service.ts`
- `src/shared/transcript-rendering.ts`
- `src/config/schema.ts`
- `src/config/template.ts`

### 7. Runtime startup still has too much blast radius at the channel or account boundary

This is still a real open problem.

`RuntimeSupervisor.createRuntime()` still uses an all-or-nothing startup model:

- it starts `agentService`
- then starts every configured channel service instance in sequence
- if any one service start fails, it stops all channel services, stops `agentService`, and throws

Practical consequence:

- one broken Slack or Telegram account can abort the entire runtime startup
- healthy channels or healthy sibling accounts do not survive that isolated startup failure
- this still behaves like `channel start failure aborts whole runtime`, not `contain failure by owner boundary`

Relevant code:

- `src/control/runtime-supervisor.ts`

### 8. Runtime health remains too coarse at channel level, not account or service level

The persisted runtime health model still keys records by `slack` or `telegram` only.

- `RuntimeHealthStore` stores one record per channel
- `RuntimeSupervisor.reportChannelLifecycle()` marks the whole channel as `failed` when a single account reports failure after startup
- instance metadata exists, but the canonical health state is still channel-wide

Practical consequence:

- in a multi-account channel, one failed account can make operator status look like the whole channel is dead
- health truth is therefore too coarse for the actual runtime isolation model

Relevant code:

- `src/control/runtime-health-store.ts`
- `src/control/runtime-supervisor.ts`

### 9. Process-level fatal policy is now bounded by monitor restart, but still not true in-place self-healing

The current fatal policy is now stronger than when this task started:

- worker marks health failed
- worker exits
- runtime monitor can restart with bounded backoff

But the deeper self-healing concern still remains:

- there is still no in-place recovery strategy inside the worker after a fatal path
- resilience is still largely process-level restart, not component-level self-heal

Practical consequence:

- the runtime is now much safer than before
- but it still is not the final shape of a highly resilient remote service

Relevant code:

- `src/control/runtime-management-cli.ts`
- `src/control/runtime-monitor.ts`

## Current Implementation Progress

The current P0 shipped slice is:

- detached runtime now installs fatal handlers for `uncaughtException` and `unhandledRejection`
- fatal shutdown records channel health as `failed` before exit instead of silently disappearing
- periodic session cleanup no longer leaves an unhandled rejection path behind
- channel runtime services now have a supervisor-owned lifecycle callback for post-start health updates
- Telegram polling conflict after startup now reports a failed channel state instead of silently stopping while the pid stays alive
- mid-prompt runner-session loss now attempts same-context recovery first, then either opens a fresh session without prompt replay when no resumable session id exists or fails truthfully while preserving the stored id
- recovery-step notes for that path now render even when channel `streaming` is `off`

Partially hardened, but not done:

- process-level bounded restart now exists through the runtime monitor
- `SessionStore` write path now uses temp-file rename, but read path still has no corruption fallback
- post-start lifecycle reporting now exists, but still does not cover broader degraded or restart-needed states consistently

Still open and should drive the retry work:

- service-grade hardening for runtime-owned state files such as atomic writes and corruption-tolerant reads
- broader post-start lifecycle reporting beyond the Telegram failure path
- cleaner terminal rendering for already-complete error bodies
- startup containment at channel or account boundary instead of runtime-wide abort
- account- or service-granular runtime health instead of channel-only health
- a clearer process-level resilience strategy beyond mark-failed-and-exit

## Current Restart And Backoff Behavior

Current restart and retry behavior exists in multiple layers, but it is still fragmented rather than governed by one explicit resilience policy.

### 1. Process-level restart

- detached `clisbot start` now runs through an app-owned runtime monitor process
- the monitor keeps one foreground runtime worker as its child and owns bounded restart backoff
- default restart policy is:
  - retry every 10 seconds for the first 3 unexpected exits
  - 15 minutes for the first 4 restart attempts
  - 30 minutes for the next 4 restart attempts
  - stop after that until an operator starts the service again
- all those numbers are now configurable through `control.runtimeMonitor.restartBackoff.stages`
- `serveForeground()` still handles `uncaughtException` and `unhandledRejection` inside the worker process
- the worker fatal path still marks health as failed, stops the in-process supervisor, and exits
- the monitor is what turns that worker exit into bounded service-level recovery

Practical consequence:

- one fatal worker exit no longer requires an immediate human restart as long as the monitor still has restart budget left
- once the configured restart budget is exhausted, operator restart is still required after fixing the root cause
- external supervision such as systemd or launchd can still be layered on top later, but the detached app path now owns its own bounded recovery contract

That means process restart is no longer entirely outside the app-owned resilience contract, but the contract is still bounded rather than unbounded self-heal.

### 2. Telegram polling retry and backoff

Telegram currently has two distinct retry paths plus one request-level rate-limit retry path.

The config key names mentioned in this section reflect the task's original audit context.

Treat them as historical implementation notes, not as the current operator-facing config guide.

Startup handoff conflict:

- `retryTelegramPollingConflict(...)` retries Telegram `getUpdates` conflict `409` during startup handoff
- it uses fixed delay from `channels.telegram.polling.retryDelayMs`
- the default config value is `1000ms`
- it stops retrying after `TELEGRAM_STARTUP_CONFLICT_MAX_WAIT_MS = 6000`

Runtime polling loop:

- normal polling errors in `TelegramPollingService.pollLoop()` use fixed-delay retry with `retryDelayMs`
- this is not exponential backoff
- post-start `409` polling conflict still marks the Telegram channel failed and stops polling instead of self-restarting the Telegram service in place

Telegram API request rate limits:

- `callTelegramApi(...)` reads Telegram `retry_after`
- it retries request-level `429` failures up to `2` times
- this is per-request retry behavior, not process restart or service restart

### 3. Runner and session retry

Runner recovery exists, but it is intentionally narrow and bounded.

Startup and pre-prompt recovery:

- `RunnerService` can retry a recoverable startup session loss by restarting the runner while preserving the stored session id
- this is a bounded retry, not an open-ended loop

Ready-state verification:

- `SESSION_READY_CAPTURE_RETRY_COUNT = 5`
- this retries short tmux readiness races while a session is being verified

Mid-prompt recovery:

- current recovery first tries reopening the same conversation context using the stored `sessionId`
- if reopen succeeds, the active run immediately nudges the runner with `continue exactly where you left off`
- same-context reopen is retried up to `2` times before the system gives up on continuity
- if same-context reopen is unavailable and no stored resumable session id exists, it opens a fresh session without replaying the old prompt
- if same-context reopen fails while a stored resumable session id exists, it preserves the mapping and fails truthfully
- this is bounded recovery, but it is not yet governed by a broader runtime-wide restart or backoff strategy

### 4. Observer-delivery retry

Channel observer delivery has its own bounded retry rule.

- `OBSERVER_RETRYABLE_FAILURE_LIMIT = 3`
- retryable observer delivery errors keep the observer attached for later updates
- non-retryable errors or exhausted retry budget detach that observer

This protects run supervision from one flaky observer, but it is observer retry only, not run restart or process restart.

### 5. Current gap summary

The current system therefore has retry logic, but mostly as local point fixes:

- external supervision provides the strongest process restart behavior today
- Telegram uses fixed-delay retry rather than an explicit exponential backoff policy
- runners use bounded recovery for specific startup and mid-run session-loss cases
- observers use a separate retry budget for delivery failures

What is still missing:

- one explicit restart and backoff policy across process, channel, account, runner, request, and observer boundaries
- account- or service-level restart ownership after post-start channel failure
- a documented rule for when fixed delay is acceptable vs when exponential backoff or jitter is required
- separate budgets and telemetry for process restart, channel restart, request retry, and observer retry
- a self-heal path for post-start Telegram polling conflict instead of fail-and-stop
- wider operator-visible telemetry for monitor decisions such as alert delivery outcomes, restart history, and child-exit classification

Current conclusion:

- `clisbot` now has several bounded retry mechanisms
- but it still does not have one mature, unified restart or backoff orchestration model
- that gap should be called out explicitly as a remaining resilience issue, not treated as solved because isolated retries already exist

## Subtasks

- [ ] add detached-runtime fatal handlers for `uncaughtException` and `unhandledRejection`
- [ ] make fatal handlers mark runtime health and exit with a clear crash reason
- [ ] remove the known unhandled cleanup-timer rejection path
- [ ] extend channel runtime contract so services can emit `failed`, `degraded`, and `recovered` lifecycle events after startup
- [ ] teach `RuntimeSupervisor` to react to those lifecycle events with bounded restart or explicit failed health state
- [ ] harden Telegram polling conflict handling so it updates health truthfully and can recover when appropriate
- [ ] decide the Slack runtime rule for post-start disconnects, reconnects, and permanent failure surfacing
- [ ] make runtime-owned health or session stores corruption-tolerant and atomic where needed
- [ ] add bounded retry for runner session disappearance while a prompt is already running, reusing the stored `sessionId` and replaying the same prompt
- [ ] make the retry budget configurable with a default of `2`
- [ ] clean up terminal error rendering so completed error bodies do not get a trailing generic `Error.` or `_Error._`
- [ ] contain startup failures at the smallest owner boundary that can be isolated, so one broken account does not abort healthy channel services by default
- [ ] split runtime health truth to the real runtime ownership level, at least account-level for multi-account channels
- [ ] define one explicit restart and backoff policy across process, channel, account, runner, request, and observer layers
- [ ] decide where fixed delay is acceptable and where exponential backoff or jitter is required
- [ ] add account- or service-level restart ownership for post-start channel failures instead of only fail-and-stop
- [ ] define process-level fatal handling policy as an explicit resilience contract:
  - when in-place recovery is allowed
  - when runtime should quarantine one owner boundary
  - when full process exit is still the correct last resort
- [ ] add targeted tests for:
  - fatal-event shutdown path
  - cleanup timer failure containment
  - Telegram post-start polling conflict
  - supervisor health transition when a started channel dies
  - in-flight runner-session loss with successful retry
  - in-flight runner-session loss after retry budget exhaustion
  - clean channel rendering for error bodies
  - startup with one broken account and one healthy account
  - health reporting when one account fails but sibling accounts remain active
  - fatal-event policy when recovery is possible versus when full exit is required

## Exit Criteria

- one background failure no longer silently kills the detached runtime without a recorded reason
- Telegram or Slack cannot die post-start while `clisbot status` still claims everything is healthy
- bounded self-heal or restart behavior exists for channel failures that should recover automatically
- in-flight runner-session loss does not fail terminally on the first recoverable blip when the runner can be resumed through the stored `sessionId`
- persistent runtime state files are handled with bounded recovery or quarantine so corruption does not become a full service outage by itself
- startup failure of one account or one service does not automatically take down unrelated healthy owners unless no safe isolation boundary exists
- runtime health reflects the real failed owner boundary closely enough that operators do not have to guess whether one account or the whole channel is down
- fatal handling policy is explicit about when the system self-recovers, when it quarantines, and when it exits
- regression coverage exists for the audited crash and silent-death paths

## Consolidated Remaining Resilience Clusters

After the latest audit passes, the remaining work groups into three clusters:

1. Session-owned recovery is still incomplete.
   - persisted-run startup recovery is not yet hardened enough
   - in-flight runner-session loss still lacks bounded same-session recovery

2. Control and slash truthfulness still has notable gaps.
   - `/stop` is still prominent because current behavior is driven by tmux-session existence, not proven active-run interruption

3. Supervisor and health isolation are still too coarse.
   - startup remains all-or-nothing across channel services
   - health truth is still channel-wide instead of account- or service-granular
   - process-level fatal handling still ends in exit rather than explicit self-heal or quarantine policy

## Implementation-Ready Checklist

Use this as the current fix-order checklist.

### 1. Session startup recovery

- Issue:
  persisted active runs can still impose too much startup risk when their tmux state is stale or partially missing
- Root cause:
  startup recovery logic is not yet hardened to the same level as the newer request-time recovery paths
- Desired behavior:
  recover or quarantine only the affected session, then let runtime startup continue
- Owner:
  `SessionService` calling `RunnerService`
- Affected files:
  - `src/agents/session-service.ts`
  - `src/agents/runner-service.ts`
- Tests needed:
  - persisted active run with missing tmux session
  - persisted active run with missing tmux server
  - runtime startup continues with unaffected sessions

### 2. `/stop` truthfulness

- Issue:
  `/stop` can report interruption based on tmux session existence rather than proven active-run interruption
- Root cause:
  slash dispatch calls `interruptSession()`, and `interruptSession()` only checks `tmux.hasSession()` before marking runtime idle and sending `Escape`
- Desired behavior:
  `/stop` should distinguish:
  - no active run
  - active run interrupted successfully
  - interrupt requested but runner state remains uncertain
- Owner:
  agents plus channels surface text
- Affected files:
  - `src/channels/interaction-processing.ts`
  - `src/agents/runner-service.ts`
  - `src/agents/session-service.ts`
  - `docs/features/agents/commands.md`
- Tests needed:
  - stop when no active run exists but tmux session still exists
  - stop when interrupt succeeds
  - stop when interrupt request cannot be verified cleanly

### 3. In-flight runner-session recovery

- Issue:
  terminal copy and follow-up cleanup for the new mid-prompt recovery path are still incomplete
- Root cause:
  the recovery flow is now present, but the final renderer and remaining status copy still lag behind the newer contract
- Desired behavior:
  keep the new bounded recovery flow, but clean up the terminal error copy and any remaining wording drift
- Owner:
  `SessionService` plus `RunnerService`
- Affected files:
  - `src/agents/session-service.ts`
  - `src/agents/runner-service.ts`
  - `src/shared/transcript-rendering.ts`
- Tests needed:
  - successful same-context recovery after one disappearance
  - fresh-session fallback without prompt replay
  - clean error rendering

### 4. Startup containment by account or service boundary

- Issue:
  one broken account can still abort the entire runtime startup
- Root cause:
  `RuntimeSupervisor.startRuntime()` still tears down all channel services and `agentService` on any startup error
- Desired behavior:
  isolate startup failure to the smallest safe owner boundary and keep healthy channel services alive when possible
- Owner:
  control and channel runtime boundary
- Affected files:
  - `src/control/runtime-supervisor.ts`
  - channel plugin implementations
- Tests needed:
  - one failed account and one healthy account in the same channel
  - one failed channel and one healthy different channel

### 5. Account-granular runtime health

- Issue:
  runtime health still reports at channel level even though runtime instances are account-scoped
- Root cause:
  health document schema only stores one record per channel
- Desired behavior:
  channel summary should aggregate account health, not overwrite it; operator output should show which account failed and which remain active
- Owner:
  control
- Affected files:
  - `src/control/runtime-health-store.ts`
  - `src/control/runtime-supervisor.ts`
  - operator health rendering paths
- Tests needed:
  - one account failed, sibling account active
  - aggregated channel summary remains truthful

### 6. Process-level fatal resilience policy

- Issue:
  current fatal policy is still mark-failed-and-exit
- Root cause:
  `handleFatal()` has no branch for in-place recovery or scoped quarantine
- Desired behavior:
  explicit decision table for:
  - recover in place
  - quarantine one owner boundary
  - exit whole process only as the last resort
- Owner:
  main runtime and control supervisor
- Affected files:
  - `src/main.ts`
  - `src/control/runtime-supervisor.ts`
  - runtime health docs
- Tests needed:
  - recoverable fatal-like event path
  - unrecoverable corruption path that still exits intentionally

## Related Docs

- [Stability](../../../features/non-functionals/stability/README.md)
- [Runner Interface Standardization And tmux Runner Hardening](../runners/2026-04-04-runner-interface-standardization-and-tmux-runner-hardening.md)
- [Agents Lifecycle And State Model Hardening](../agents/2026-04-04-agents-lifecycle-and-state-model-hardening.md)
- [Operator Control Surface And Debuggability](../control/2026-04-04-operator-control-surface-and-debuggability.md)
