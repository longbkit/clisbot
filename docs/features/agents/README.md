# Agents

## Summary

The agents layer is the backend-agnostic operating layer for agents in `clisbot`.

It owns the durable mental model of an agent and its session state.

## State

Active

## Why It Exists

The product is not just a transport wrapper around tmux.

It needs a stable system for:

- agents
- sessions
- workspaces
- queueing
- memory
- tools
- skills
- subagents
- session-scoped runtime policy

That operating model must continue to make sense even if tmux is replaced or supplemented by other runners.

## Scope

- agent identity and ownership
- session lifecycle
- agent-scoped command dispatch
- session-scoped runtime policy and overrides
- workspace ownership
- queueing and concurrency rules
- memory and context ownership
- tools, skills, and subagent model
- lifecycle and health state

## Non-Goals

- tmux-specific mechanics
- channel-specific rendering
- operator control UX

## Related Task Folder

- [docs/tasks/features/agents](../../tasks/features/agents)

## Related Test Docs

- [docs/tests/features/agents](../../tests/features/agents/README.md)
- [Agent Commands](commands.md)
- [Session Identity](sessions.md)
- [Agent Workspace Attachments](attachments.md)

## Dependencies

- [Runners](../runners/README.md)
- [Configuration](../configuration/README.md)

## Current Focus

Make the current `agentId` plus `sessionKey` model reliable now, while leaving truthful room for future memory, tools, skills, subagents, and richer agent self-management.

The next important growth areas are:

- session-scoped runtime policy:
  - follow-up continuation behavior per conversation
  - temporary quiet mode or mention-only mode per thread
  - runtime control APIs that agents themselves can invoke when the user asks
  - stale runner cleanup that reclaims tmux resources without resetting logical conversation identity
- agent self-knowledge and context bootstrap:
  - truthful identity, capability, and limit awareness from docs, source, and current environment
- agent runtime introspection:
  - read and mutate queue, loop, and active-run state through a standard agent-facing bridge
- agent-managed queueing:
  - let an active agent create bounded same-session follow-up prompts through a documented queue control surface
- agent work-management interface:
  - normalize task and work-item operations now, then split a dedicated feature area later only if backend adapters grow large enough
