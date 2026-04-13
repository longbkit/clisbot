# Architecture Boundary Clarification For Surfaces, Agents, And Runners

## Summary

Clarify the main architecture boundaries across:

- channels
- control
- configuration
- agents
- runners

The current high-level split is directionally correct, but the docs still leave several important seams too blurry:

- command lifecycle across layers
- channel versus control surface ownership
- permission ownership across control, channels, and configuration
- follow-up ownership across configuration, channels, and agents
- canonical continuity state versus derived runtime or debug state

## Status

Planned

## Why

The repository already documents the five-system split, but the current architecture docs still make some flows feel under-specified.

That especially affects:

- slash-command ownership
- in-channel observer commands versus operator control
- privilege and permission checks
- session-scoped overrides versus surface-specific participation rules
- what belongs in persisted session continuity metadata

Without one cleanup pass, later feature work will keep patching symptoms instead of using one stable mental model.

## Scope

- refine the architecture docs so the five-system split reads as one coherent model
- define the lifecycle of one inbound message or slash command across layers
- make channel-first ingress and parsing explicit
- distinguish clearly between:
  - channel-owned surface replies
  - agent-owned command intents and session semantics
  - runner-owned execution primitives
  - control-owned operator actions
- define where permission semantics live versus where permission policy is configured
- define where follow-up defaults, participation semantics, and session overrides each belong
- clarify which persisted session fields are canonical continuity state versus derived runtime or debug metadata

## Non-Goals

- changing implementation code in this slice
- redesigning the current feature backlog itself
- rewriting every feature doc immediately

## Target Clarifications

### 1. Command lifecycle

The architecture should say explicitly:

1. channels receive the inbound message or slash command first
2. channels parse, gate, and decide whether the command stops at the surface
3. the agents layer handles commands that represent conversation or session intent
4. runners execute backend-specific primitives when needed
5. control remains an out-of-band operator surface, not the default in-chat path

### 2. Surface split

Make this distinction explicit:

- in-channel commands such as `/start`, `/status`, `/whoami`, `/attach`, `/detach`, and `/watch` are chat-surface behavior
- out-of-band commands such as top-level inspect, restart, stop, and global loop management belong to control

### 3. Follow-up ownership

Refine the ownership split to:

- configuration owns default policy
- channels own surface-specific participation semantics
- the agents layer owns normalized per-session override state

### 4. Permission ownership

Refine the permission split to:

- control owns operator-facing permission semantics and access-control behavior
- configuration owns the persisted policy config that drives those rules
- channels may enforce route-local privilege gates for in-chat commands before handoff, but they do not become the canonical owner of operator permission semantics

This should make it easier to explain:

- why `/attach` or `/detach` in chat can still be surface-gated
- why top-level operator actions still belong to control
- why config stores permission policy without becoming the behavioral owner

### 5. Agents scope

Tighten the agents layer so the core reads more like a session kernel:

- agent identity
- session continuity
- workspace ownership
- queueing and concurrency
- session-scoped overrides

Keep memory, tools, skills, and subagents visible as future seams without overstating how settled they already are.

### 6. Canonical versus derived state

Make it explicit which persisted fields are:

- canonical continuity state
- derived runtime snapshot
- debug or operator convenience metadata

## Exit Criteria

- `docs/architecture/` describes the five-system split without major boundary ambiguity
- command lifecycle across channels, agents, runners, and control is documented explicitly
- permission ownership across control, channels, and configuration is documented explicitly
- follow-up ownership no longer reads as if one layer owns all of it
- persisted session continuity docs distinguish canonical state from derived runtime state
- later feature and task docs can link to one clarified architecture baseline instead of restating these rules ad hoc

## Related Docs

- [Architecture Overview](../architecture/architecture-overview.md)
- [Surface Architecture](../architecture/surface-architecture.md)
- [Runtime Architecture](../architecture/runtime-architecture.md)
- [Model Taxonomy And Boundaries](../architecture/model-taxonomy-and-boundaries.md)
- [Agents Feature](../features/agents/README.md)
- [Channels Feature](../features/channels/README.md)
- [Control Feature](../features/control/README.md)
- [Configuration Feature](../features/configuration/README.md)
