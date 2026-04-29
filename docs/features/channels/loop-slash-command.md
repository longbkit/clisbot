# Loop Slash Command

## Summary

`/loop` is a channel-owned slash command for repeating an agent prompt on an interval, on a wall-clock schedule, or for a fixed number of iterations.

Examples:

- `/loop 5m check CI`
- `/loop check deploy every 2h`
- `/loop 1m --force check CI`
- `/loop check deploy every 1m --force`
- `/loop every day at 07:00 check CI`
- `/loop every weekday at 07:00 standup`
- `/loop every mon at 09:00 weekly review`
- `/loop 5m`
- `/loop every day at 07:00`
- `/loop 3 check CI`
- `/loop 3`
- `/loop 3 /codereview`
- `/loop /codereview 3 times`
- `/loop status`
- `/loop cancel <id>`

## Scope

- managed interval loops with immediate first run
- managed wall-clock loops with timezone-aware next-run scheduling
- bounded times loops
- slash-style loop bodies treated as normal agent prompt text
- maintenance fallback through workspace `LOOP.md`
- queue-truthful times behavior

## Invariants

- `/loop` is intercepted by the channel control layer before agent prompt submission
- compact durations like `5m` are always interval mode
- bare positive integers like `3` are always times mode
- `every day at 07:00` is always wall-clock schedule mode
- `every weekday at 07:00` is always wall-clock schedule mode
- `every mon at 09:00` is always wall-clock schedule mode
- `every 3 minutes` is always interval mode
- `3 times` is always times mode
- every `/loop` command must include an interval, count, or wall-clock schedule
- when no prompt is supplied after that interval, count, or schedule, clisbot reads `LOOP.md` from the routed agent workspace
- interval loops must be at least `1m`
- interval loops below `5m` require `--force`
- for leading interval syntax, `--force` must appear immediately after the interval token, for example `/loop 1m --force check CI`
- for `every ...` syntax, `--force` must appear immediately after the interval clause, for example `/loop check deploy every 1m --force`
- wall-clock schedules must use `HH:MM` in 24-hour format
- wall-clock schedules wait until the next matching local time; they do not fire immediately on creation
- wall-clock schedules resolve timezone through the shared effective timezone resolver: one-off loop timezone, route/topic timezone, agent timezone, bot timezone, `app.timezone`, legacy default fallbacks, then host fallback only if no configured timezone exists
- once created, a wall-clock loop stores the resolved effective timezone on the loop itself so later config changes do not silently shift old schedules
- chat `/loop` wall-clock creation persists immediately; the no-side-effect first-loop confirmation gate is for operator CLI creation
- every chat wall-clock creation response must include the resolved timezone, next run in local time plus UTC, and the exact cancel command so the user can quickly undo and recreate if timezone is wrong
- AI agents should inspect `clisbot loops --help` for schedule/loop/reminder requests when they need to create loops through the CLI
- interval loops receive an id and are tracked in managed state
- managed loops stop after `control.loop.maxRunsPerLoop` attempts
- managed loop scheduling is `skip-if-busy`, so a busy session drops that tick instead of piling a queue
- managed loops are persisted and restored after restart from session state
- scheduled interval and calendar ticks may post one brief start notification in the same surface, based on route `surfaceNotifications.loopStart`
- times mode reserves all iterations immediately so later queued messages do not jump ahead
- interval mode starts the first run immediately, then schedules later enqueue events on the configured cadence
- wall-clock mode schedules the first run at the next matching wall-clock time in the loop timezone
- a loop body that starts with `/` is treated as agent prompt text, not as another clisbot control command
- `/loop status` shows active managed loops for the current session
- `/loop cancel --all` cancels the current session's loops, while `/loop cancel --all --app` cancels all loops in the app

## Current Limits

- times mode does not add delay between iterations
- `/stop` stops the current run only; it does not cancel loops

## Implementation Notes

### Persistence Model

- loops are persisted in the session store at `session.storePath`
- default path is `~/.clisbot/state/sessions.json`
- when `CLISBOT_HOME` is set, the default path becomes `<CLISBOT_HOME>/state/sessions.json`
- the persisted file is a JSON object shaped like `Record<sessionKey, StoredSessionEntry>`
- each session entry owns its own loop state so loop lifecycle stays scoped to the routed conversation session
- in this doc, the generic name is `loops`; the current persisted field in code is still `intervalLoops` for compatibility

### Persisted Loop Shape

Common fields for every stored loop:

- `id`
- `maxRuns`
- `attemptedRuns`
- `executedRuns`
- `skippedRuns`
- `createdAt`
- `updatedAt`
- `nextRunAt`
- `promptText`
- `promptSummary`
- `promptSource`
- `createdBy`

Interval loops also store:

- `intervalMs`
- `force`

Wall-clock loops also store:

- `kind: "calendar"`
- `cadence`
- `dayOfWeek` when cadence is weekly
- `localTime`
- `hour`
- `minute`
- `timezone`
- `force: false`

### Runtime Lifecycle

- create: the control layer parses `/loop`, resolves prompt text or `LOOP.md`, creates a loop record, and persists it into the session entry before scheduling continues
- persist: every loop state transition updates the same session entry, including attempt counters, skip counters, execution counters, and `nextRunAt`
- restore: on runtime startup, `AgentService.start()` reloads persisted loops from session state and re-arms timers for loops whose `attemptedRuns` are still below `maxRuns`
- cancel: `/loop cancel ...` removes the loop from both in-memory scheduler state and the persisted session entry

### Scheduling Details

- interval loops run once immediately after creation, then compute later runs from `intervalMs`
- wall-clock loops do not run immediately; they wait for the next matching local time
- wall-clock timezone is resolved by the shared effective timezone resolver used by prompt timestamps and loop creation
- the effective wall-clock timezone is frozen onto the persisted loop record at creation time so later config changes do not silently shift existing schedules
- chat `/loop` does not use the first-loop no-side-effect gate; instead it must make correction cheap by showing timezone, local next run, UTC next run, and cancel guidance after creation
- restart recovery uses the persisted `nextRunAt` timestamp instead of replaying an entire missed history

### Code Paths

- `src/agents/agent-service.ts`
- `src/agents/session-state.ts`
- `src/agents/session-store.ts`
- `src/agents/loop-state.ts`

## Related Docs

- [Task Doc](../../tasks/features/channels/2026-04-12-loop-slash-command.md)
- [RFC](../../research/channels/2026-04-12-loop-slash-command-rfc.md)
- [Channel Test Cases](../../tests/features/channels/README.md)
