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
