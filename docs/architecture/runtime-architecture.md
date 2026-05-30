# clisbot Runtime Architecture

## Document Information

- **Created**: 2026-04-04
- **Purpose**: Define the runtime systems behind agent execution
- **Status**: Working architecture

## Scope

This document covers:

- agents
- runners
- configuration as the runtime control plane

## Current Runtime Owner Map

The current runtime naming should stay explicit:

- `AgentService` is the thin facade that wires the runtime together
- `SessionService` is the session-owned runtime owner inside `agents`
- `RunnerService` is the backend-owned runtime owner behind that session owner

Short version:

- `SessionService` decides which `sessionId` is active for one `sessionKey`
- `RunnerService` uses that decision to start, capture, or resume the backend
- `src/runners/tmux/*` contains lower-level tmux mechanics, not continuity decisions

Ownership intent:

- `AgentService` coordinates entrypoints and shared dependencies, but should not grow into a second orchestration owner
- `SessionService` owns session continuity, including the current `sessionKey -> active sessionId` mapping, admission, active-run truth, persisted run recovery, observer-facing execution state, and explicit session rebinding semantics
- `RunnerService` owns backend readiness, backend session bootstrap or
  resume, input submission, snapshot capture, normalized streaming,
  backend-specific recovery, and the backend-specific logic needed to:
  - launch with a supplied `sessionId`
  - capture a tool-created `sessionId`
  - resume with a stored `sessionId`

Current implementation gap:

- the target ownership split above is the architecture contract
- current code is not fully converged yet
- `src/agents/runtime/runner-service.ts` still mixes backend execution work with some
  `SessionService`-owned responsibilities such as:
  - deciding explicit `sessionId` creation for explicit-id launch paths through
    the current `SessionMapping` helper
  - mutating active `sessionId` continuity through `SessionMapping` instead of a
    `SessionService`-owned API
  - deciding some continuity changes directly during retry, restart, and
    `/new` flows
- that means `RunnerService` is currently a mixed-owner implementation, even
  though the target architecture keeps continuity and `sessionId` source
  ownership in `SessionService`
- future cleanup should move active-mapping changes and explicit-id creation
  behind a `SessionService`-owned API while keeping tmux or backend launch or
  capture or resume mechanics runner-owned

In plain language:

- `RunnerService` currently does too much
- the architecture does not need to change
- the code needs one more cleanup pass so `SessionService` chooses continuity
  and runner code only executes backend mechanics

The old names `ActiveRunManager` and `RunnerSessionService` are no longer part of the architecture vocabulary.

Active-run liveness contract:

- an in-memory active run is supervised by `SessionService` and its run monitor
- the monitor owns transitions from runner loss to recovery or terminal failure
- persisted session runtime is only a resumable projection; if it says `running` or `detached` but the runner backend no longer has the tmux session, clear that projection to `idle`
- user ingress should not clear an in-memory active run just because a tmux liveness probe fails, because that would skip the monitor-owned recovery path

## Agents Rule

The agents layer is backend-agnostic.

It owns:

- agents
- session-key routing
- sessions
- workspaces
- queueing
- memory
- tools
- skills
- subagents
- lifecycle and health state

The agents layer must not depend on tmux-specific terms such as panes, send-keys, or socket-level commands.

In the current codebase, `SessionService` is the main runtime owner that enforces this boundary for active session execution.

## Runner Rule

Runners are backend-specific.

They own:

- current tmux-backed execution
- future ACP integrations
- future SDK integrations

Every runner must normalize its behavior into one internal contract for the agents layer.

Runners provide the backend-specific `sessionId` mechanics used by session continuity:

- accept an explicit session id from the session owner when the backend supports caller-supplied ids
- capture a tool-native session id from backend output when the native tool creates it
- resume or relaunch using a stored session id when supported
- fail truthfully when a backend cannot honor the requested session-id behavior

In the current codebase, `RunnerService` is the concrete owner of those
backend-specific operations, while `SessionService` remains the owner of the
stored active mapping.

## Standard Runner Contract

At minimum, a runner should provide:

- start
- stop
- submit input
- capture snapshot
- stream output updates
- surface lifecycle state
- surface backend errors

Backend quirks belong inside runner implementations, not Agents.

## Run Supervision Rule

Run supervision is authoritative and transport-independent.

That means:

- runner monitoring and active-run lifecycle must stay alive even when a user-facing channel transport is degraded
- channel observer delivery is best-effort and must not be allowed to terminate runner monitoring
- transient channel send or edit failures may degrade one observer, but they must not be promoted into canonical run failure by default
- terminal run state must still settle truthfully even when one observer or one surface cannot currently render live updates

If a channel needs retries, fallback rendering, or observer detachment, that policy belongs at the observer or surface boundary, not inside runner supervision.

## Configuration Rule

Configuration is the local runtime control plane.

It decides:

- which channels are enabled
- which runner an agent uses
- which agent receives a route
- which session policy shapes the runtime identity for that route
- which workspace and policy defaults apply

Configuration should be expressive enough to support future runners without changing the semantics of the agents layer.

## Persistence Rule

Persist only what must survive process restarts.

Current examples:

- local config
- processed event state
- durable runtime metadata when introduced intentionally
- session metadata required to reconnect logical conversation state to resumable runner or AI CLI state

Current persisted session continuity metadata is intentionally small:

- `sessionKey`
- `agentId`
- active `sessionId`
- `workspacePath`
- `runnerCommand`
- `runtime`
- `loops`
- `queues`
- `recentConversation`
- `updatedAt`

Current continuity invariants:

- one `sessionKey` may be reused by more than one chat surface when routing policy intentionally collapses them into one conversation
- at any moment, one `sessionKey` maps to one active `sessionId`
- over time, that same `sessionKey` may rotate to a different `sessionId`
  - examples:
    - `/new`
    - explicit resume or rebind
    - backend reset or expiry
- the reverse invariant from `sessionId` back to `sessionKey` is not yet a stable public contract

Diagnostic read rule:

- when a live run already knows the current `sessionId` in runtime memory,
  operator and chat diagnostics should prefer that runtime value over older
  persisted metadata
- those surfaces should still show whether the displayed value is already
  persisted
- repeated reads must not turn into continuous persistence writes when the
  value is unchanged

Persistence behavior should therefore be:

- write early when a new `sessionId` first becomes known
- retry or defer when the write path is temporarily unavailable
- avoid re-writing the same unchanged `sessionId` on every poll or status read

Cross-process state rule:

- clisbot runtime, monitor, HTTP listeners, and one-shot CLI commands may run
  in different OS processes
- in-memory state and caches are process-local and must not be treated as
  shared truth across runtime and CLI boundaries
- when more than one process can read or mutate the same runtime-facing state,
  use an explicit durable store, IPC path, or runtime command path; file-backed
  stores must reload or validate a file version before serving cached state
- tests for these features should include at least one cross-process or
  independent-store-view regression, because same-process unit tests can miss
  stale cache behavior

Do not persist transient runner artifacts as canonical state in the agents layer without a documented reason.

For AI CLI-backed runners, this implies one important split:

- persist session continuity metadata such as `sessionKey`, active `sessionId`, and last-known resume metadata
- do not treat tmux pane ids, tmux window ids, or ephemeral process state as canonical truth in the agents layer

## Testing Standard

Runtime tests should verify:

- agents lifecycle and ownership rules
- OpenClaw-compatible session-key behavior for routed conversations
- runner contract behavior
- backend-specific quirks staying inside runners
- configuration selecting the correct runtime behavior
- current owner boundaries staying truthful:
  - `AgentService` remains a thin facade
  - `SessionService` remains the session-owned runtime owner
  - `RunnerService` remains the backend-owned runtime owner
