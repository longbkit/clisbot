# Session Runner Boundary Validation

## Purpose

This note holds the validation detail behind the task doc:

- [Session Runner Boundary Simplification And Validation](../../tasks/2026-04-15-session-runner-boundary-simplification-and-validation.md)

The task doc stays brief and implementation-oriented. This file keeps the deeper reasoning that justified the target ownership model.

## Validation Rubric

Before promoting any concern into a top-level service, check whether it has:

1. independent owner
2. independent lifecycle
3. independent failure boundary
4. independent replacement seam
5. independent user-visible contract

If a concern does not pass those tests, it should stay a:

- model
- state machine
- policy
- helper
- cross-cutting invariant

not a top-level service.

## Re-Validated Current Truth

### 1. `Session` is irreducible and agent-owned

Validated against:

- `docs/features/agents/README.md`
- `docs/features/agents/sessions.md`
- `docs/architecture/runtime-architecture.md`
- `src/agents/session/session-state.ts`
- `src/agents/session/session-store.ts`
- `src/agents/routing/resolved-target.ts`
- `src/agents/runtime/agent-service.ts`

Current truth:

- `sessionKey` is the durable logical conversation identity
- queueing, follow-up state, runtime state, and continuity metadata attach to that `sessionKey`
- session continuity remains valid even if tmux dies or the backend later changes

Implication:

- `Session` is not removable
- the main agent-layer orchestration service should be session-owned

### 2. `Runner` is irreducible and backend-owned

Validated against:

- `docs/features/runners/README.md`
- `docs/architecture/runtime-architecture.md`
- `src/agents/runtime/runner-service.ts`
- `src/runners/tmux/client.ts`
- `src/runners/tmux/session-handshake.ts`
- `src/runners/tmux/run-monitor.ts`

Current truth:

- backend startup, resume, capture, submit, and backend-specific recovery live at the runner boundary
- tmux quirks are already being normalized behind a runner-facing seam

Implication:

- the runner-facing service should be named and owned as a backend runtime service, not as a session helper

### 3. `Run` is irreducible, but not a top-level service yet

Validated against:

- `docs/architecture/runtime-architecture.md`
- `docs/features/agents/README.md`
- `src/agents/session/session-service.ts`
- `src/agents/session/run-observation.ts`
- `src/channels/message/processing-indicator.ts`

Current truth:

- `Run` has a real lifecycle state machine
- observers, detach semantics, and final settlement depend on that lifecycle
- but run state never stands alone outside session scope

Implication:

- `Run` should stay first-class as a model and state machine
- it does not currently justify another top-level service

### 4. Queue is real, but session-owned

Validated against:

- `docs/features/agents/README.md`
- `docs/features/non-functionals/stability/README.md`
- `src/agents/queue/job-queue.ts`
- `src/channels/message/interaction-processing.ts`
- `src/agents/commands/commands.ts`
- `src/agents/runtime/agent-service.ts`

Current truth:

- queue is user-visible through `/queue` and loop behavior
- bash work also uses a queue namespace
- `AgentJobQueue` is only the execution primitive
- the product contract for queueing spans agent commands, interaction processing, loop behavior, and busy-state policy

Implication:

- queue cannot be dismissed as an invisible detail
- queue still does not justify a separate top-level manager
- it should stay as a session-owned admission contract

### 5. Recovery and stability are invariants, not business services

Validated against:

- `docs/features/non-functionals/stability/README.md`
- `docs/tasks/features/stability/2026-04-15-runtime-crash-containment-and-service-self-healing.md`
- `src/agents/session/session-service.ts`
- `src/agents/runtime/runner-service.ts`
- `src/main.ts`

Current truth:

- restart truthfulness, stale-state recovery, and observer containment cut across agents, runners, and channels
- turning those into another manager would blur ownership further

Implication:

- recovery logic should live under the true session or runner owners
- stability should be expressed as invariants plus regression tests

## Owner Matrix

| Concern | Owner | Why |
| --- | --- | --- |
| `sessionKey` continuity | agents / `SessionService` | logical conversation truth is backend-agnostic |
| active run lifecycle | agents / `SessionService` | run truth is session-scoped and surfaced to channels or control |
| queue or steer admission | agents / `SessionService` | user-visible session policy |
| observer attach or detach | agents / `SessionService` | observer truth follows run lifecycle |
| startup recovery of persisted runs | agents / `SessionService` calling runner boundary | startup must rebuild session-owned truth |
| backend readiness | runners / `RunnerService` | backend-specific readiness and faults belong here |
| backend resume and session-id mechanics | runners / `RunnerService` | runner-specific behavior |
| tmux snapshot, submit, monitor primitives | runners | backend mechanics |
| rendering and thread UX | channels | surface-specific behavior |
| operator summaries | control using agent session state | read model, not canonical owner |

## Mapping Notes

| Current | Current Problem | Target | Target Owner |
| --- | --- | --- | --- |
| `AgentService` | mixes facade duties with orchestration | keep as facade | agents |
| `SessionService` | name sounds like registry, but owns orchestration and session admission | fold into `SessionService` | agents |
| `RunnerService` | name hides the main runner recovery boundary | rename to `RunnerService` | runners |
| `AgentJobQueue` | queue is real, but conceptual place is unclear | keep as internal session admission structure | agents |
| `ensureRunnerReady()` | name hides backend-readiness and recovery semantics | `ensureRunnerReady()` | runners |
| `recoverPersistedRuns()` | name sounds passive, but performs startup recovery | `recoverPersistedRuns()` | agents |

## Second-Pass Validation Notes

### `ensureRunnerReady()` is really runner readiness

Validated against:

- `src/agents/runtime/runner-service.ts`
- `src/agents/session/session-service.ts`

Current truth:

- it does not own admission, queueing, or canonical run lifecycle
- it ensures backend readiness, applies startup recovery, and returns the first usable snapshot

Implication:

- renaming toward `ensureRunnerReady()` is structurally honest, not cosmetic

### `recoverPersistedRuns()` is startup recovery, not passive sync

Validated against:

- `src/agents/session/session-service.ts`
- `src/agents/session/session-state.ts`

Current truth:

- startup calls it before serving new work
- it reads persisted runtime state, probes tmux liveness, clears stale state, rebuilds in-memory active runs, and restarts monitors

Implication:

- `recoverPersistedRuns()` is more truthful
- this is the right place to harden stale-session startup behavior

### Current docs already support the simplified ownership model

Validated against:

- `docs/architecture/runtime-architecture.md`
- `docs/features/agents/README.md`
- `docs/features/agents/sessions.md`
- `docs/features/runners/README.md`
- `docs/features/non-functionals/stability/README.md`

Current truth:

- docs already place queueing, session lifecycle, and continuity in agents
- docs already place backend readiness and quirks in runners
- the main remaining drift is naming and orchestration shape in code

## Third-Pass Validation Notes

### Persistence boundary is thicker than some docs imply

Validated against:

- `src/agents/session/session-store.ts`
- `src/agents/session/session-state.ts`
- `src/agents/loops/loop-state.ts`
- `src/agents/session/run-observation.ts`
- `docs/features/agents/sessions.md`
- `docs/architecture/runtime-architecture.md`
- `docs/architecture/architecture-overview.md`

Current truth:

- `sessions.json` persists more than thin continuity metadata
- it also persists follow-up state, runtime hints, and loop records

Implication:

- implementation should not pretend the session store is only an identity bridge
- docs should distinguish continuity metadata from persisted runtime hints

### Startup flow is already session-owned at the top

Validated against:

- `src/agents/runtime/agent-service.ts`
- `src/agents/session/session-service.ts`
- `src/agents/runtime/runner-service.ts`

Current truth:

- runtime startup enters through `AgentService.start()`
- startup recovery happens before new work is served
- request-time prompt execution also crosses the agent layer first

Implication:

- the main problem is misleading ownership names inside the flow
- this supports a KISS refactor rather than a new orchestration layer

### Surfaces already expose session-owned truth

Validated against:

- `src/channels/message/interaction-processing.ts`
- `src/control/runtime/runtime-summary.ts`
- `test/interaction-processing/interaction-processing.test.ts`
- `test/runtime-summary.test.ts`

Current truth:

- `/status` and `/whoami` already expose session-scoped truth
- operator summaries already report active runs from agent runtime state rather than raw tmux state

Implication:

- the proposed target model matches current operator-facing and user-facing reality better than the current class names do

### Recovery coverage is still asymmetric

Validated against:

- `src/agents/runtime/runner-service.ts`
- `src/agents/session/session-service.ts`
- `src/runners/transcript/transcript-rendering.ts`
- `src/config/core/schema.ts`
- `src/config/core/template.ts`
- `test/agent-service/agent-service.test.ts`

Current truth:

- startup and pre-prompt session loss already have partial recovery helpers
- mid-prompt runner-session loss still fails terminally today
- transcript renderers append generic trailing error markers even when the real error body is already complete

Implication:

- the simplified architecture should state the split clearly:
  - `SessionService` owns retry budget, prompt replay, observer continuity, and final failure semantics
  - `RunnerService` owns same-session-id reopen or resume and backend readiness

### `/stop` truthfulness still leaks through blurred ownership

Validated against:

- `src/channels/message/interaction-processing.ts`
- `src/agents/runtime/runner-service.ts`
- `src/agents/session/session-service.ts`
- `docs/features/agents/commands.md`

Current truth:

- `/stop` is documented as interrupting current processing
- current behavior is closer to `interrupt attempted against an existing tmux session`

Implication:

- session owner should decide whether a real active run exists
- runner owner should report whether interrupt was attempted, acknowledged, or uncertain
- channels should render the truthful state instead of overclaiming interruption

### Supervisor and health remain coarser than the real runtime isolation model

Validated against:

- `src/control/runtime/runtime-supervisor.ts`
- `src/control/runtime/runtime-health-store.ts`
- `src/main.ts`
- `test/runtime-supervisor/runtime-supervisor.test.ts`

Current truth:

- startup is still all-or-nothing across channel services
- runtime health is still persisted per channel, not per account or service instance
- process-level fatal handling still exits after marking failure

Implication:

- operator health and blast radius are still coarser than the actual runtime ownership boundaries
- later control and stability work should refine that separately from this naming cleanup
