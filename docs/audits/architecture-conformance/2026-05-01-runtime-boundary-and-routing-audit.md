# Runtime Boundary And Routing Audit

## Summary

Baseline audit of the current runtime boundary and routed conversation flow.

Current conclusion:

- the runtime boundary is mostly correct
- channels own surface-facing route and conversation targeting
- agents own canonical `sessionKey` identity and persisted continuity, including the active `sessionKey -> sessionId` mapping
- runners provide tool-native `sessionId` pass-through or capture or resume mechanics behind that continuity owner
- one real implementation leak remains: `RunnerService` still carries some
  `SessionService` work

## Scope

In scope:

- `src/channels/`
- `src/agents/`
- route resolution
- conversation target resolution
- `sessionKey` ownership
- `sessionId` ownership

Out of scope:

- queue behavior details
- loop behavior details
- broader authorization policy review

## Expected Standard

The governing architecture says:

- channels own presentation and interaction
- agents own backend-agnostic session identity and continuity
- runners own backend-specific execution and the backend-specific operations used to pass through or capture or resume native `sessionId` values

## Current Flow

Current routed flow is:

1. channel receives user input
2. channel resolves route from config
3. channel resolves conversation target for that surface and routing policy
4. agents build canonical `sessionKey` semantics and load current continuity for that conversation
5. agents resolve workspace, session name, and runtime defaults
6. runners start or reuse the backend session
7. runners perform any backend-specific launch or capture or resume mechanics needed for the live `sessionId`
8. agents persist the active `sessionKey -> sessionId` mapping truthfully
9. channels render user-visible output

## Findings

### Finding 1

The ownership split is structurally correct.

- Slack and Telegram resolve route and surface-local conversation targeting
- canonical `sessionKey` builders still live in `src/agents/session/session-key.ts`
- runner-specific session-id operations still depend on `RunnerService`, not the channel layer

This is the right high-level boundary.

### Finding 2

`RunnerService` is architecturally backend-owned, but the current file still
lives under `src/agents/runtime/runner-service.ts`.

That does not break runtime behavior by itself, but it weakens the repo's
navigation truth because the architecture says the backend owner is the runner
side of the system.

### Finding 2A

`RunnerService` is also still a mixed-owner implementation.

Concrete examples in the current code:

- it mints explicit `sessionId` values for explicit-id launch paths
- it reads stored continuity directly from `sessionState`
- it writes and clears stored mapping state through session-entry helpers
- it still decides some clear or rotate behavior directly during retry,
  restart, and `/new` flows

That means the current code shape is not yet the fully-clean target split.

The architecture still stands:

- `SessionService` should own active-mapping changes and explicit-id source
  decisions
- runner code should own tmux or backend launch or capture or resume mechanics

### Finding 3

The route and conversation-target boundary is clean enough, but it is split
across:

- provider route config
- provider session-routing helpers
- shared agent key builders

That split is acceptable today, but future channel additions will benefit from
a more explicit channel-to-agent handoff contract.

### Finding 4

The bigger current gap is no longer only doc clarity.

- docs were part of the problem
- but current implementation still leaves `SessionService` mapping mutations
  inside `RunnerService`
- that means this is now clearly a runtime-boundary cleanup task, not only a
  wording-sync task

## Recommendations

Fix now:

- update architecture and task docs so the current hybrid state is described
  truthfully
- add a focused follow-up task that moves continuity mutation semantics out of
  `RunnerService`
- keep that follow-up scoped to semantic cleanup first; file relocation can
  stay separate

Backlog-worthy:

- tighten file and naming alignment so backend-owned runtime code is easier to
  find and reason about
- pull explicit-id creation and continuity mapping mutation behind one
  session-owned API
- make the channel-to-agent handoff contract more explicit before new channel
  families expand
- keep architecture, feature docs, glossary, and audit wording aligned on
  `sessionKey` continuity versus backend-specific `sessionId` mechanics

## Follow-Up

- if this audit produces execution work, create or update a shallow task doc in
  `docs/tasks/`
- keep the stable architecture contract in `docs/architecture/`
- keep the current cross-cutting `what` and `why` in
  `docs/features/non-functionals/architecture-conformance/`
