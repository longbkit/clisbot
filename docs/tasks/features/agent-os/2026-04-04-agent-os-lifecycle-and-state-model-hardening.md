# Agent-OS Lifecycle And State Model Hardening

## Summary

Make the Agent-OS lifecycle and state model reliable without leaking runner-specific mechanics into it.

## Status

In Progress

## Why

The system promise depends on persistent agent sessions with clear ownership of sessions, workspaces, queueing, and health.

That operating model must remain valid even if tmux is replaced by another runner.

## Scope

- agent identity and session ownership
- session continuity beyond live tmux survival
- workspace ownership
- queueing and concurrency rules
- health and restart state
- seams for memory, tools, skills, and subagents

## Current Truth

- `sessionKey` remains the logical conversation identity
- Agent-OS persists AI CLI `sessionId` continuity metadata by `sessionKey`
- the system can recreate a killed tmux runner on a later prompt and resume the same logical conversation when the backend supports resume
- stale tmux cleanup is implemented without forcing logical conversation reset
- reset policy is not implemented yet

## Non-Goals

- tmux-specific commands
- channel rendering behavior

## Subtasks

- [ ] define the canonical agent and session state model
- [x] define the split between `sessionKey`, active AI CLI `sessionId`, and runner instance identity
- [x] define the minimum persistent session store needed for runner restart and resume
- [ ] define restart and health transitions at the Agent-OS level
- [x] define runner-loss recovery rules for resumable versus non-resumable backends
- [x] define tmux runner sunsetting versus session reset as separate lifecycle events
- [ ] define workspace ownership and lifecycle rules
- [ ] define truthful extension seams for memory, tools, skills, and subagents
- [ ] add Agent-OS ground-truth tests

## Dependencies Or Blockers

- runner contract clarity

## Related Docs

- [Agent-OS Feature](../../../features/agent-os/README.md)
- [Agent-OS Tests](../../../tests/features/agent-os/README.md)
