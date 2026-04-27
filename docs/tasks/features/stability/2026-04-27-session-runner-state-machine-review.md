# Session Runner State Machine Review

## Status

Planned

## Priority

P0

## Summary

Review and tighten the session and runner state machines so active-run truth, runner liveness, final-message delivery, and persisted runtime projection cannot drift into ambiguous states.

## Why

Recent tmux crash and stale-runtime debugging showed that the current implementation has the right recovery pieces, but the state model still needs one explicit pass from architecture to code.

The risky ambiguity is this class of scenario:

1. a prompt is submitted and becomes an active run
2. the runner crashes mid-run
3. clisbot attempts same-context recovery
4. recovery fails or only a fresh runner can be opened
5. final channel delivery may fail or may not happen before process failure
6. status, runner list, queue, loop, and steering must still show one truthful state

## Current Behavior To Verify

Current intended behavior:

- in-memory active run exists while `SessionService` owns the monitor
- if tmux is lost mid-run, monitor calls recovery before terminal failure
- if same-context recovery succeeds, clisbot reopens the runner and submits `continue exactly where you left off`
- if recovery cannot preserve context, clisbot fails the current active run truthfully
- `failActiveRun()` sets persisted `runtime.state` to `idle`, not `running`
- `failActiveRun()` removes the in-memory active run
- observer/final-message delivery failure must not keep the active run stuck as `running`

Important nuance:

- if process death happens before `failActiveRun()` runs, persisted `runtime.state` can remain `running` or `detached`
- that persisted state is a stale projection, not live run truth
- startup or ingress reconciliation should clear it to `idle` when no live tmux runner exists
- `status` may report `runner=lost` before reconciliation, but should not silently mutate state as a read-only command

## Scope

- Review `SessionRuntimeState`, active run state, runner liveness, and final delivery boundaries.
- Define which component owns each transition:
  - prompt admitted
  - prompt submitted
  - run detached
  - runner lost
  - recovery started
  - recovery succeeded
  - recovery exhausted
  - final delivery succeeded
  - final delivery failed
  - process restarted with stale persisted runtime
- Verify queue and loop scheduling use only session-scoped live-active truth.
- Verify steering behavior when the active runner target disappears.
- Verify `runner list` remains live-runner-only and `status` reports persisted/runtime mismatch truthfully.

## Non-Goals

- Redesign the runner backend abstraction.
- Add distributed HA or cross-process active-run ownership.
- Change prompt context, sender, auth, or route concepts.

## Open Questions

1. Should final-message delivery success be tracked separately from active-run terminal state?
2. Should there be an explicit terminal-delivery state or just a delivery audit field?
3. When fresh-session fallback succeeds but same-context recovery fails, should the fresh runner remain warm for the next prompt or be killed?
4. Should `status` stay read-only forever, with a separate `doctor --fix` or recovery command for stale runtime cleanup?
5. Should active-run persisted projection move out of the session continuity record into a dedicated supervision record?

## Done Definition

- Architecture state-machine docs define terminal run state separately from final-message delivery.
- Code paths are audited against the documented state machine.
- Tests cover:
  - mid-run crash recovered with same context
  - mid-run crash unrecoverable but final delivery succeeds
  - mid-run crash unrecoverable and final delivery fails
  - process crash before terminal state is persisted
  - stale persisted runtime plus missing tmux does not block queue, loop, or new user prompt
- Operator surfaces clearly distinguish:
  - live active run
  - persisted stale runtime
  - live idle runner
  - missing runner
  - final delivery failure
