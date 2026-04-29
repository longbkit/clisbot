# Loop Slash Command

## Summary

Add `/loop` as a first-class channel slash command with three explicit modes:

- interval loops such as `/loop 5m check CI`
- wall-clock loops such as `/loop every day at 07:00 check CI`
- bounded count loops such as `/loop 3 /codereview`
- managed interval loop controls such as `/loop status` and `/loop cancel`

## Status

In Progress

## Why

Users need a lightweight way to keep work moving without manually resending the same prompt.

The first useful slice is:

- parse interval versus times predictably
- support slash-style loop bodies such as `/codereview`
- support maintenance loops through workspace `LOOP.md`
- keep queue ordering truthful
- keep interval loops bounded, visible, and cancellable

## Scope

- add `/loop` parsing at the channel slash-command boundary
- support:
  - `/loop <interval>`
  - `/loop <interval> <prompt>`
  - `/loop <prompt> every <number> <unit>`
  - `/loop <prompt> every <compact-duration>`
  - `/loop every day at <HH:MM> [<prompt>]`
  - `/loop every weekday at <HH:MM> [<prompt>]`
  - `/loop every <mon|tue|...> at <HH:MM> [<prompt>]`
  - `/loop <times> <prompt>`
  - `/loop <times> <slash-command>`
  - `/loop <prompt> <times> times`
  - `/loop status`
  - `/loop cancel`
  - `/loop cancel <id>`
  - `/loop cancel --all`
  - `/loop cancel --all --app`
- treat compact durations such as `5m` as interval mode
- treat bare positive integers such as `3` as times mode
- require every `/loop` command to include either an interval, a count, or a wall-clock schedule
- load maintenance prompt text from workspace `LOOP.md` when the user does not provide a prompt after that interval, count, or schedule
- make times mode reserve all iterations immediately in queue order
- make interval mode start once immediately, then continue on a managed scheduler
- make wall-clock mode wait until the next matching local time in the resolved timezone
- require interval loops to run at least every `1m`
- require `--force` for interval loops below `5m`
- require `--force` to stay attached to the interval clause:
  - `/loop 1m --force check CI`
  - `/loop check deploy every 1m --force`
- resolve wall-clock loop timezone from one-off loop override, route/topic, agent, bot, `app.timezone`, legacy defaults, then host timezone
- persist the effective timezone on each wall-clock loop so later config edits do not silently shift old jobs
- cap every interval loop by `control.loop.maxRunsPerLoop`
- cap total active interval loops by `control.loop.maxActiveLoops`
- persist active interval loops in session state and restore them after runtime restart
- use `skip-if-busy` for interval loops so later ticks do not pile into the queue
- document parse priority, expected outputs, and error messages for implementation and testing

## Non-Goals For This Slice

- a separate long-lived loop runtime context distinct from the conversation session
- per-iteration delay in times mode
- per-iteration proactive status notifications
- ownership rules on loop cancellation

## Subtasks

- [x] add RFC and feature docs for `/loop`
- [x] add slash parser support for times and interval forms
- [x] add maintenance-loop fallback through `LOOP.md`
- [x] add configurable `control.loop.maxRunsPerLoop`
- [x] add configurable `control.loop.maxActiveLoops`
- [x] add queue-truthful times scheduling
- [x] add managed interval scheduling with restart restore
- [x] add managed wall-clock scheduling with restart restore
- [x] add `/loop status` and `/loop cancel`
- [x] add unit tests for parse and interaction flow
- [x] add channel test-doc coverage
- [x] decide that recurring loops should survive restart
- [x] decide that interval overlap policy is `skip-if-busy`
- [ ] decide whether bounded loops should optionally run in their own context rather than the current session

## Validation Notes

- parser coverage should prove:
  - compact interval syntax
  - trailing `every ...` syntax
  - trailing `every 1m` compact syntax
  - leading count syntax
  - trailing `N times` syntax
  - rejection of zero or negative counts
  - rejection of bare `/loop`
  - rejection of interval loops below `1m`
  - rejection of interval loops below `5m` without `--force`
  - rejection of misplaced `--force`
  - daily, weekday, and day-of-week wall-clock parsing
  - rejection of invalid wall-clock `HH:MM`
- interaction coverage should prove:
  - times mode queues all reserved runs immediately
  - interval mode starts now and stores the right interval and loop id
  - wall-clock mode stores the right timezone and first `nextRunAt`
  - maintenance mode reads `LOOP.md`
  - missing `LOOP.md` fails with a direct remediation message
  - count limits reject above configured max
  - `/loop status` shows active managed loops
  - `/loop cancel` cancels managed loops
  - restored runtime still sees persisted active interval loops
- live validation should prove:
  - `/loop 3 ...` produces ordered replies in the routed Slack thread
  - `/loop 1m --force ...` produces an immediate run, survives restart, and remains visible in `/loop status`

## Exit Criteria

- routed Slack and Telegram conversations can use `/loop` without manual workaround prompts
- parse behavior is deterministic and documented
- times mode is truthful with the existing queue model
- interval and wall-clock modes are bounded, visible, cancellable, and restored after restart
- maintenance mode fails clearly when `LOOP.md` is absent
