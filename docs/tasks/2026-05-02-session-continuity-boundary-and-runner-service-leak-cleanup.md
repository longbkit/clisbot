# Session Continuity Boundary And RunnerService Leak Cleanup

## Summary

Close the remaining gap between the accepted architecture and the current code:

- keep session continuity and `sessionId` source ownership in
  `SessionService`
- keep backend launch or capture or resume mechanics in runner code
- remove continuity mutation and explicit-id minting leakage from
  `src/agents/runtime/runner-service.ts`

## Simple Mental Model

If you only remember four lines, remember these:

- `sessionKey` says which clisbot conversation this is
- `sessionId` says which native tool conversation is currently active for that
  `sessionKey`
- `SessionService` owns that mapping and any decision to change it
- runner code only knows how to launch, capture, or resume the backend with
  already-chosen inputs

## Status

Done

Historical task record with shipped follow-up. The main continuity cleanup is
done for `0.1.50`; read the deeper design sections below as the task's working
target, not as a claim that every aspirational sub-idea is still an active
release-track requirement.

## Why This Task Exists

This task existed because the docs had converged before the code had. That
gap is now closed enough for the main session-id continuity path:

- session-owned `SessionMapping` now handles explicit-id minting plus
  continuity reads and writes
- `RunnerService` no longer owns direct mapping clear or set behavior
- ambiguous resume-startup and `/new` capture failures preserve the stored
  `sessionId` instead of clearing it automatically
- `/whoami`, `/status`, `runner list`, and `runner watch` now expose
  `sessionId` plus persistence annotation

The remaining follow-up outside this task is explicit session rebinding as a
future control surface. The earlier idea of a dedicated memory-first
live-session-id registry is not being carried as a `0.1.50` release blocker.

## Implemented

- added `src/agents/session/session-mapping.ts` as the session-owned continuity seam
- kept `createSessionId()` and moved its effective ownership behind that
  agents-layer seam
- renamed runner-side parsing toward `parseRunnerSessionId()`
- updated startup, resume, and `/new` paths so continuity mutations no longer
  happen through runner-owned helper names
- changed ambiguous stale-resume startup from "clear and fall back fresh" to
  "preserve mapping and require explicit user intent for `/new`"
- changed `/new` capture failure from "clear mapping" to "preserve previous
  mapping and fail truthfully"
- updated chat and control diagnostics to show `sessionId` plus persistence
  annotation
- added targeted regression coverage for stale-resume preservation, `/new`
  preservation-on-failure, and runtime-first diagnostics

## Target Model

### `SessionService` Owns

- active `sessionKey -> sessionId -> workspacePath` continuity
- set-active or clear or rotate semantics
- explicit-id minting when a backend accepts caller-supplied ids
- continuity persistence through a session-owned API

### Runner Code Owns

- backend launch or reuse or resume mechanics
- backend-specific capability checks
- capture of tool-created `sessionId`
- truthful backend failure reporting

### tmux Backend Owns

- tmux process and pane primitives
- tmux-specific bootstrap and prompt-submission truthfulness
- tmux-specific capture and monitoring helpers

## File Ownership Reading Guide

Use this when reading code so you do not mix the layers:

- `src/agents/session/session-service.ts`
  - conversation owner
  - decides whether to keep, replace, or clear the active mapping
- `src/agents/runtime/runner-service.ts`
  - runner-facing adapter used by `SessionService`
  - should perform backend work, not continuity decisions
- `src/runners/tmux/*`
  - lower-level tmux backend implementation
  - should not own durable `sessionKey -> sessionId` mapping

## What Moves Out Of `RunnerService`

- explicit-id creation such as `createSessionId()`
- direct reads of stored continuity as the top-level decision point
- direct calls to `touchSessionEntry()` for mapping writes
- direct calls to `clearSessionIdEntry()` for mapping clears
- direct mapping decisions inside retry, restart, and `/new` flows when those
  decisions are really continuity policy
- wrapper names that hide real meaning behind vague verbs such as
  `persist...` or `sync...`

## What Stays In `RunnerService`

- build backend launch args from already-chosen `sessionId` inputs
- call tmux or backend launch and resume paths
- capture a tool-created `sessionId`
- return truthful backend failure when resume or explicit-id launch cannot work

## What This Task Does Not Change

To keep scope tight, this task does not need to change:

- tmux pane scraping strategy by itself
- queue ownership
- loop ownership
- follow-up policy ownership
- public `/sessions ...` command design beyond keeping room for it later
- storage-file split away from `sessions.json`

## Diagnostic Read Rule

After this cleanup, these surfaces should all read session identity the same
way:

- `clisbot runner list`
- `clisbot runner watch`
- `/whoami`
- `/status`

Current shipped diagnostic rule:

- `/whoami`, `/status`, `clisbot runner list`, and `clisbot runner watch` show
  `sessionId` plus persistence state when clisbot knows it
- `persisted` means the same value is already saved in continuity state
- `not persisted yet` means clisbot knows the current value but durable state
  has not caught up yet
- if no `sessionId` is shown, clisbot has not saved or confirmed one yet
- chat and control reads no longer probe every live pane just to infer a newer
  id during ordinary diagnostics

The stronger runtime-memory-first registry described later in this task was a
working design target during implementation, but it is not being kept as an
active release requirement after the shipped continuity cleanup.

## Smart Persistence Rule

When runtime memory knows a newer `sessionId` than persistence:

- try to persist it early in the startup, capture, recovery, or `/new` flow
- do not wait for a later unrelated diagnostic read if the write can happen
  sooner
- do not re-persist the same unchanged `sessionId` on every poll, watch tick,
  or repeated `/status` or `/whoami`

The desired behavior is:

- early best-effort persistence when the id first becomes known
- bounded retry or cooldown when capture/write is temporarily unavailable
- no continuous write spam from read surfaces

## Proposed Implementation Shape

1. add one `SessionService`-owned continuity API
   - `sessionMapping.get(sessionKey)`
   - `sessionMapping.setActive(sessionRef, { sessionId, reason })`
   - `sessionMapping.clear(sessionRef, { reason, preserveRuntime? })`
   - this may call into `session-state.ts` internally, but `session-state.ts`
     should stay an implementation detail, not the public owner
2. move explicit-id minting behind `SessionService`
   - keep `createSessionId()` if that remains the simplest name
   - the important change is session ownership, not renaming for its own sake
3. refactor `RunnerService` to consume already-chosen continuity inputs instead
   of deciding continuity semantics directly
4. add one runtime-memory session-id read path for diagnostics
   - active run memory should be able to report the current live `sessionId`
   - read surfaces should also report whether that value is already persisted
5. keep `src/runners/tmux/*` unchanged except for any signature cleanup needed
   to accept clearer runner inputs
6. do not combine this slice with a file move from `src/agents/runtime/runner-service.ts`
   into `src/runners/` unless the semantic cleanup is already done

## Naming Cleanup Map

This is the practical move map the implementer should follow first.

| Current Code | Problem | Target Direction |
| --- | --- | --- |
| `createSessionId()` in `session-identity.ts` | the real problem is runner-owned explicit-id minting, not the helper name by itself | keep `createSessionId()` and move it behind `SessionService` or a small session-owned helper |
| `extractSessionId()` in `session-identity.ts` | generic name hides that this parses runner output | rename toward runner parse meaning, for example `parseRunnerSessionId()` |
| `persistStoredSessionId()` in `RunnerService` | name is vague and hides a stored mapping write inside runner-owned code | replace with session-owned `sessionMapping.setActive(...)` |
| `syncStoredSessionIdForResolvedTarget()` in `RunnerService` | mixed read/capture/cooldown/write branch is too opaque | split into explicit caller flow using `sessionMapping.get(...)` plus capture plus `sessionMapping.setActive(...)` |
| `clearSessionIdEntry()` in `session-state.ts` | generic entry helper name hides mapping semantics | keep private or demote; call through `sessionMapping.clear(...)` instead |
| `touchSessionEntry(...sessionId...)` | one helper name is doing too many semantic jobs | stop using it as the mapping seam |
| `retryFreshStartAfterStoredResumeFailure()` in `RunnerService` | runner code clears continuity after failed resume startup | move the clear decision behind `sessionMapping.clear(...)` with an explicit reason |
| `restartRunnerWithFreshSessionId()` / `triggerNewSessionInLiveRunner()` | runner code still decides fresh-session continuity mutation directly | keep runner mechanics here, but route set/clear/rotate through `SessionService` semantics |
| `AgentService.getSessionDiagnostics()` | previously returned only persisted `storedSessionId` | now returns runtime-first `sessionId` plus persistence annotation |
| `runner-debug-state.ts` and `runner-cli.ts` | list/watch previously derived session id from persisted entries only | now prefer the live parsed session id when available and show whether it is persisted |

Naming note:

- avoid a public API that makes readers ask "what is `resolved`?"
- avoid names such as `bindActiveSessionMapping(...)` that force readers to
  guess whether the call is durable
- avoid `persistStoredSessionId(...)` as the public seam when the real meaning
  is simply "set the active stored mapping"

## Implementation Plan

If implementing this in the smallest safe order, do it like this:

1. move `createSessionId()` under `SessionService` ownership or a small
   session-owned helper
   - keep the existing name unless a broader session API later makes a better
     name obvious
2. introduce one continuity-shaped API under `SessionService` ownership
   - read
   - set active mapping
   - clear active mapping
   - keep any `session-state.ts` helpers behind that seam
3. add one runtime-memory session-id diagnostic source
   - active run memory should carry the current live `sessionId` when known
   - diagnostics should be able to compare runtime value versus persisted value
4. replace direct continuity writes and continuity decisions in `RunnerService`
   - no more `touchSessionEntry(...sessionId...)` as the semantic seam
   - no more `clearSessionIdEntry(...)` as the semantic seam
   - retry and `/new` flows should call explicit continuity operations instead
     of mutating stored mapping ad hoc
5. update read surfaces
   - `/whoami`
   - `/status`
   - `runner list`
   - `runner watch`
   - show runtime-first `sessionId` plus persistence annotation
6. leave tmux handshake and monitoring behavior alone unless signatures really
   need cleanup
7. run targeted regression coverage for:
   - fresh startup with tool-created id
   - fresh startup with explicit id
   - restart or resume with stored id
   - `/new` rotation
   - failed resume recovery
   - diagnostics prefer runtime-memory id when it is fresher than persistence
   - diagnostics show persisted versus not-persisted state
   - diagnostics do not trigger repeated unchanged writes

## Suggested File Order

To avoid refactor drift, touch files in this order:

1. `src/agents/session/session-identity.ts`
   - clarify explicit-id vs parse naming
2. `src/agents/session/session-service.ts`
   - add the semantic continuity seam owned by the session layer
3. `src/agents/session/session-state.ts`
   - support that seam with narrower internal helpers if needed
4. `src/agents/session/session-service.ts` and active-run memory
   - expose runtime-memory session-id diagnostics when a live run knows them
5. `src/agents/runtime/runner-service.ts`
   - switch call sites from generic helpers to the continuity seam
6. `src/agents/runtime/agent-service.ts`, `src/control/runner/runner-debug-state.ts`,
   `src/control/runner/runner-cli.ts`, and chat status rendering
   - apply runtime-first read precedence and persistence annotation
7. targeted tests
8. docs sync only after the code shape settles

## Exit Criteria

- `RunnerService` no longer mints explicit `sessionId` values
- continuity mapping writes and clears no longer enter through broad generic
  session-entry helper names
- `RunnerService` no longer decides continuity mutation semantics directly in
  retry or `/new` flows
- explicit-id creation is clearly `SessionService`-owned
- `runner list`, `runner watch`, `/whoami`, and `/status` prefer runtime-memory
  `sessionId` truth when available
- those read surfaces also show whether the displayed `sessionId` is already
  persisted
- unchanged repeated reads do not cause continuous persistence writes
- docs and code tell the same ownership story
- startup, resume, and `/new` paths still pass targeted regression coverage

## Related Docs

- [Runtime Architecture](../architecture/runtime-architecture.md)
- [Session Key And Session Id Continuity Decision](../architecture/decisions/2026-05-01-session-key-and-session-id-continuity-decision.md)
- [Session Key And Runner Session Id Audit](../audits/agents/2026-05-01-session-key-and-runner-session-id-audit.md)
- [Session Runner Boundary Simplification And Validation](2026-04-15-session-runner-boundary-simplification-and-validation.md)
