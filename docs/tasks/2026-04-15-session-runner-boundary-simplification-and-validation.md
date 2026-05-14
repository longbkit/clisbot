# Session Runner Boundary Simplification And Validation

## Summary

Define the smallest runtime refactor that clarifies ownership without inventing new layers:

- keep `Session`, `Run`, and `Runner` as the irreducible concepts
- keep one session-owned runtime owner in agents
- keep one backend-owned runtime owner in runners
- remove names that sound small or infrastructural while owning orchestration or recovery

## Status

Done for the naming and owner-map clarification slice.

## Implementation Status

The naming migration is complete, but the deeper continuity-boundary cleanup is
not.

Implemented:

- oversized runtime CLI and summary entry files were split so the ownership refactor landed on smaller seams
- deep validation notes moved into a dedicated research note instead of staying duplicated in the task doc
- runtime ownership names now match the architecture:
  - `SessionService` is the session-owned runtime owner in `agents`
  - `RunnerService` is the backend-owned runtime owner behind that session owner
- startup recovery and persisted active-run recovery now use the new names end to end across code, tests, and docs

Not yet fully converged:

- `RunnerService` still directly mints explicit `sessionId` values for
  explicit-id launch paths
- `RunnerService` still directly reads and mutates stored session continuity
- the fully-clean split now lives in a follow-up task instead of being treated
  as already done

## Migration Status

External migration:

- none
- no config rewrite
- no CLI surface rewrite required for operators
- no persisted data migration required before the first implementation slice

Internal migration progress:

Completed:

- split oversized runtime CLI entrypoints under `src/control/`
- split oversized runtime summary rendering under `src/control/`
- moved deep validation notes into `docs/research/agents/`
- renamed the backend runtime owner to `RunnerService`
- renamed the session-owned runtime owner to `SessionService`
- normalized runtime method names around `ensureRunnerReady()` and `recoverPersistedRuns()`
- updated tests and docs to match the new ownership names

## Why

Current runtime behavior works, but naming and ownership drift are growing:

- `SessionService` sounds like a registry, but owns orchestration and startup handoff
- `RunnerService` sounds like a helper, but is the main backend recovery boundary
- queue is a user-visible contract, but its ownership story is still muddy

If this stays vague, future fixes will keep patching symptoms instead of clarifying the real owners.

## Decision

This task locks the target model:

- `AgentService` stays as a thin facade
- `SessionService` becomes the session-owned runtime owner in `agents`
- `RunnerService` becomes the backend-owned runtime owner in `runners`
- `Run` stays a first-class model inside the session owner
- queue stays a session-owned admission contract
- do not introduce a new queue manager, recovery manager, or run manager

Truthfulness note:

- the owner model above is the architecture target
- current code still keeps `RunnerService` implemented in
  `src/agents/runtime/runner-service.ts`
- the later continuity-boundary cleanup should finish semantic ownership first;
  file relocation, if still wanted after that, is a separate cleanup choice

## Non-Goals

- context assembly redesign
- memory retrieval architecture
- channel rendering redesign
- auth redesign
- broader feature expansion outside runtime ownership cleanup

## Target Model

### `SessionService`

Layer:

- agents

Owns:

- `sessionKey` continuity
- queue or steer or reject admission decisions
- active run registry and lifecycle
- persisted run recovery at session scope
- observer-facing execution truth

Must not own:

- tmux-specific mechanics
- backend bootstrap quirks
- channel rendering

### `RunnerService`

Layer:

- runners

Owns:

- backend readiness
- submit, snapshot, and normalized streaming
- backend-specific recovery and faults
- backend session bootstrap or resume mechanics

Must not own:

- queue policy
- session-scoped follow-up policy
- active `sessionKey -> sessionId` continuity truth

### `Run`

`Run` remains a first-class state machine inside `SessionService`, not a separate top-level coordinator.

## Previous To Current Mapping

| Previous | Problem | Current |
| --- | --- | --- |
| `AgentService` | facade and orchestration mixed together | keep as thin facade |
| `ActiveRunManager` | name hides session-owned orchestration | `SessionService` |
| `RunnerSessionService` | name hides backend recovery boundary | `RunnerService` |
| `AgentJobQueue` | real contract, unclear story | keep as internal session structure |
| `preparePromptSession()` | hid runner-readiness meaning | `ensureRunnerReady()` |
| `reconcileActiveRuns()` | sounded passive, but did startup recovery | `recoverPersistedRuns()` |

## Implemented Shape

1. the backend runtime boundary was renamed first
2. active-run orchestration stayed under `SessionService`
3. startup recovery stayed under the same ownership model
4. docs and tests were synced after names and ownership stabilized

## Risks To Watch

- over-collapsing `Run` until lifecycle truth becomes sloppy
- hiding queue too aggressively and losing the user-visible mental model
- renaming types without actually moving ownership
- recreating split-brain ownership by letting `AgentService` grow back into a second owner

## Validation And Research

Detailed validation is kept here so this task doc stays brief:

- [Session Runner Boundary Validation](../research/agents/2026-04-15-session-runner-boundary-validation.md)

That research note captures:

- the five-test rubric for top-level services
- re-validated current ownership truths
- persistence and startup-flow findings
- recovery asymmetry and `/stop` truthfulness notes
- supervisor and health-boundary findings that should stay separate from this naming cleanup

## Exit Criteria

- one concise runtime mental model explains the system without accidental class names
- top-level services are justified by real ownership, not by habit
- queue remains session-owned
- runner recovery and backend startup truth remain runner-owned
- startup recovery is hardened without inventing a fake recovery manager
- docs and code use names that match real ownership boundaries

All exit criteria are now satisfied.

Historical note:

- these criteria were satisfied for the naming and owner-map refactor slice
- they should not be read as claiming that session continuity leakage has been
  fully removed from `RunnerService`

## Related Docs

- [Architecture Overview](../architecture/architecture-overview.md)
- [Runtime Architecture](../architecture/runtime-architecture.md)
- [Domain Language](../architecture/domain-language.md)
- [Agents Feature](../features/agents/README.md)
- [Session Identity](../features/agents/sessions.md)
- [Runners Feature](../features/runners/README.md)
- [Stability](../features/non-functionals/stability/README.md)
- [Architecture Boundary Clarification For Surfaces, Auth, Agents, And Runners](2026-04-13-architecture-boundary-clarification-for-surfaces-agents-and-runners.md)
- [Session Continuity Boundary And RunnerService Leak Cleanup](2026-05-02-session-continuity-boundary-and-runner-service-leak-cleanup.md)
