# Live Session Id Runtime Truth And Memory Registry

## Status

Dropped

## Priority

P1

## Summary

Restore the original session-id design boundary:

- keep one in-memory live `sessionId` registry as the first read source
- seed that registry from persisted session continuity on startup or rehydrate
- update that registry immediately when runner capture succeeds, even if
  durable persistence fails
- keep persistence as durable backing, not the primary live-truth source

## Why

This follow-up was proposed while the continuity cleanup was still settling.

Current release decision:

- the shipped `SessionMapping` seam plus `sessionId` persistence annotation are
  enough for `v0.1.50` release readiness
- there is no current evidence that a dedicated memory-first live-session-id
  registry is required to keep ordinary operator or chat flows truthful
- if a later bug shows that persisted-first diagnostics are hiding an actually
  known live `sessionId`, reopen this as a concrete runtime-truth task instead
  of carrying it as a speculative release blocker

The current implementation improved continuity ownership, but it still does not
fully implement the originally imagined runtime-truth model for `sessionId`.

Current gap:

- chat and control surfaces now expose `sessionId` plus persistence state
- but the "live" value is still derived mostly from persisted session entries
  or active-run fields that themselves were seeded from persistence
- this means `capture succeeded but persist failed` can still look like "no
  live session id yet", even though the runner-side truth is already known

That does not currently break the run itself, and it is not being kept as an
active release-track task.

## Desired Contract

1. `sessionId` reads should prefer in-memory live truth.
2. Persisted session continuity should seed memory on startup, not replace it.
3. Successful runner capture should update live memory immediately.
4. Durable persistence may lag briefly, fail transiently, or need retry.
5. Diagnostics should show:
   - live `sessionId`
   - stored `sessionId`
   - whether persistence is already caught up

## Scope

- define one session-owned in-memory registry for live `sessionId`
- seed it from stored continuity during startup and persisted-run rehydrate
- update it on capture, `/new`, resume, and same-context recovery flows
- make chat and control diagnostics read from that registry first
- keep the startup warning path truthful when persistence fails but live
  runtime identity is already known

## Out Of Scope

- redesigning session storage format
- adding cross-process coordination
- changing the `/new` contract again
- changing state-store durability strategy beyond what is needed for truthful
  read precedence

## Implementation Notes

- `SessionMapping` should not stay only as a store wrapper if the intended
  owner contract is "session memory first"
- `SessionService.getLiveSessionId()` should read a true runtime source, not a
  persisted projection copied into `activeRuns`
- startup and rehydrate flows should load stored `sessionId` into the live
  registry once, then let live capture move ahead independently
- if persistence fails after capture, the user-facing warning should still be
  paired with a truthful live `sessionId` on diagnostics

## Done Definition

- there is one explicit in-memory live `sessionId` owner in the session layer
- startup and rehydrate seed it from stored continuity
- successful capture updates it before any durable write result is known
- `/status`, `/whoami`, `runner list`, and `runner watch` use live-first read
  precedence consistently
- tests cover:
  - capture succeeded and persist failed
  - startup seeded from stored continuity
  - live session id newer than stored session id
  - diagnostics showing both live and stored truth when they differ

## Drop Reason

- no current release blocker remains after the continuity cleanup, trust-prompt
  fix, and restart truthfulness fix
- the remaining gap is an operator-truth polish idea, not a proven broken
  contract in the shipped `0.1.50-beta.12` path
- explicit session rebinding remains the clearer later continuity feature to
  track when new evidence appears

## Related

- [Session Continuity Boundary And RunnerService Leak Cleanup](../../2026-05-02-session-continuity-boundary-and-runner-service-leak-cleanup.md)
- [Session Runner State Machine Review](../stability/2026-04-27-session-runner-state-machine-review.md)
- [Session Key And Session Id Continuity Decision](../../../architecture/decisions/2026-05-01-session-key-and-session-id-continuity-decision.md)
