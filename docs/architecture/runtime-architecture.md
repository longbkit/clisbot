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

Ownership intent:

- `AgentService` coordinates entrypoints and shared dependencies, but should not grow into a second orchestration owner
- `SessionService` owns session continuity, admission, active-run truth, persisted run recovery, and observer-facing execution state
- `RunnerService` owns backend readiness, backend session bootstrap or resume, input submission, snapshot capture, normalized streaming, and backend-specific recovery

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

Runners also own backend-specific session-id mechanics:

- create a tool-native session id when the backend requires runner-side creation
- capture a tool-native session id from backend output when the backend creates it
- resume or relaunch using that stored session id when supported

In the current codebase, `RunnerService` is the concrete owner of that backend-specific runtime boundary.

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
- `updatedAt`

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
