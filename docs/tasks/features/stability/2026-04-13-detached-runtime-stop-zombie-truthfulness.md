# Detached Runtime Stop Zombie Truthfulness

## Summary

Fix the detached runtime shutdown path so `clisbot stop` reports truthfully when the runtime has already exited into a zombie or defunct state, instead of timing out and leaving a misleading operator failure.

## Status

Done

## Why

Live validation exposed a shutdown-path truthfulness bug:

- `clisbot stop` could send `SIGTERM`
- the runtime would complete its real shutdown work
- the pid could remain briefly visible as zombie or defunct
- the operator command would still wait for a fully missing pid and then fail with `did not stop within 10000ms`

That is a control-layer bug, not a channel or runner bug. It makes stop semantics look unsafe even when the runtime is already down.

## Scope

- trace detached-runtime stop semantics in `control/runtime-process`
- distinguish `running`, `zombie`, and `missing` pid states for shutdown truthfulness
- treat zombie or defunct as exited for `stop`, `status`, and start-path stale-pid cleanup
- add regression coverage for both stale-zombie and post-`SIGTERM` zombie transitions
- rerun automated validation

## Non-Goals

- distributed singleton locking across machines
- broader service-stop refactors in channel plugins or runtime supervisor
- changing operator-facing stop UX beyond making it truthful

## Root Cause

The old liveness probe only used `kill(pid, 0)`.

On POSIX, that returns success for zombie or defunct processes too, so the system treated a dead runtime as still alive. The detached stop loop therefore kept polling until timeout even though the runtime had already finished shutting down.

## Implementation

- added an explicit `ProcessLiveness` model in `src/control/runtime/runtime-process.ts`
- kept `kill(pid, 0)` as the fast existence gate
- on POSIX, added richer state probing:
  - Linux prefers `/proc/<pid>/stat`
  - other Unix-like platforms fall back to `ps -o stat= -p <pid>`
- zombie or defunct now counts as exited for:
  - `clisbot stop`
  - runtime status reporting
  - stale pid reuse checks during detached start
- the change stays inside `control`, which owns operator runtime truthfulness

## Validation Notes

- targeted regression: `bun test test/runtime-process.test.ts`
- repository typecheck: `bun x tsc --noEmit`
- full automated suite: `bun test`

## Follow-Up

- if later live traces show a channel or plugin service delaying shutdown before the pid reaches zombie or missing, that should be tracked as a separate runtime-stop latency task rather than folded back into this liveness fix
