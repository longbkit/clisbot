# Model Taxonomy And Boundaries

## Status

Working architecture reference

## Purpose

This document defines how repository models should be named, separated, and evolved.

Its goal is to stop a common early-stage architecture failure:

- mixing agent-layer state, runner contracts, channel payloads, control payloads, persistence records, and transient runtime state into the same object shape

When that happens, the codebase becomes ambiguous in ways that are expensive later:

- channel contracts become unstable
- control flows start depending on accidental backend fields
- optional fields begin to represent hidden loading states
- validation becomes weaker over time
- sync and collaboration work inherit unclear ownership boundaries

## Core Rule

Do not define a model only by its attributes.

Every significant model must be defined by all of the following:

1. role
2. ownership
3. lifecycle
4. invariants
5. allowed boundaries

## Taxonomy

### 1. Agent Entities

Agent entities describe the canonical operating truth of the system.

They should answer:

- what exists in the agent operating model
- how agents, sessions, workspaces, tools, skills, memory, and subagents relate
- which mutations are meaningful

Agent entities are not automatically the same as channel DTOs, persistence rows, or operator views.

### 2. Persistence Model

Persistence models describe what the backend stores durably.

They should be:

- deterministic
- versioned when needed
- migration-friendly
- explicit about canonical ownership

Do not add transient runtime concerns into persistence shape.

### 3. Surface Contracts

Surface contracts define what crosses a channel or control boundary.

They do not need to mirror persistence shape exactly.

Surface contracts must be explicit about:

- which fields are guaranteed
- which fields are omitted by design
- whether a payload is raw session scope, cleaned conversation scope, or control scope

### 4. Projections And Summaries

A projection is a read-oriented shape derived from canonical data for a specific use case.

Projection rules:

- projections are not canonical truth
- projections may duplicate derived values intentionally
- projections must never silently replace the underlying entity model

### 5. Runner Runtime State

Runner runtime state is local state required to make execution usable but not canonical.

Examples:

- current snapshot cache
- inflight stream state
- backend connection state
- transient trust-prompt state

Runner runtime state must stay separate from:

- persistence shape
- channel DTOs
- agent entities unless there is an explicit adapter layer

### 6. Surface View Models

Surface view models are render-oriented shapes prepared for a channel or control surface.

They are acceptable when they reduce UI complexity, but they must stay clearly local to rendering concerns.

Do not let surface view models leak back into agent-layer contracts or persistence logic.

## Naming Rules

Names must reveal the layer.

Recommended naming pattern:

- `AgentEntity`
- `SessionEntity`
- `WorkspaceEntity`
- `RunnerSnapshot`
- `ChannelMessageDto`
- `ControlViewModel`
- `RuntimeState`
- `SelectionState`

## Required Questions For Every Model

Before introducing or changing a model, answer these questions:

1. What layer does it belong to?
2. Who owns this field canonically?
3. Is this field stored, derived, projected, or transient?
4. Can this object exist in partial form?
5. If partial, how is that state represented in the type system?
6. Which system is allowed to emit it?
7. Which code is responsible for mapping it into another layer?

## Invariant Discipline

Every major model family should have documented invariants.

At minimum, define:

- identity invariants
- parent-child or ownership invariants
- derived-field invariants
- mutation ownership invariants
- serialization invariants
