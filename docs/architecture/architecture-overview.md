# muxbot Architecture Overview

## Document Information

- **Created**: 2026-04-04
- **Purpose**: Define the architecture decisions that should hold across the repository
- **Status**: Working architecture

## Governing References

Use these docs together:

- [Surface Architecture](surface-architecture.md)
- [Runtime Architecture](runtime-architecture.md)
- [Model Taxonomy And Boundaries](model-taxonomy-and-boundaries.md)

## Core Decision

Keep the system split into five explicit product systems:

- channels
- agent-os
- runners
- control
- configuration

## Why This Matters

If these systems blur together:

- the codebase becomes harder to reason about
- transport behavior starts leaking backend quirks
- operator workflows become entangled with user-facing chat flows
- testing becomes weaker
- future refactors get more expensive than they should be

We need explicit boundaries early.

## System Boundaries

### 1. Channels

Channels own how humans or external clients interact with the system.

Examples:

- Slack
- Telegram
- API-compatible channel surfaces
- future Discord adapters

Channels own:

- inbound message handling
- outbound rendering and streaming behavior
- thread and reply UX
- default chat-first rendering for a channel
- explicit transcript request commands when whole-session visibility is needed

Channels must not own:

- backend-specific runner mechanics
- agent lifecycle state

### 2. Agent-OS

Agent-OS is the backend-agnostic operating layer for agents.

It owns:

- agent identity
- session-key identity
- sessions
- workspaces
- queueing
- memory
- tools
- skills
- subagents
- lifecycle and health state

Agent-OS must not depend on tmux-specific concepts.

### 3. Runners

Runners are the execution backends.

They own:

- tmux runner behavior today
- future ACP runners
- future SDK runners
- standard input, output, snapshot, and streaming contracts for Agent-OS

Runners normalize backend quirks but do not decide user-facing presentation.

### 4. Control

Control owns operator-facing actions and views.

Examples:

- inspect
- attach
- restart
- stop
- health and debug flows

Control must stay separate from user-facing channel behavior.

### 5. Configuration

Configuration is the local control plane.

It owns:

- route mapping
- runner selection
- policy flags
- agent definitions
- workspace defaults
- chat rendering policy
- transcript request command configuration

## Data Flow Rule

Use this default flow:

1. configuration wires channels, agent-os, runners, and control together
2. channels accept inbound input
3. agent-os resolves the target agent and session key
4. agent-os invokes a runner through the standard runner contract
5. channels render the resulting output for the destination surface
6. control can inspect or intervene without becoming part of the user conversation

## One Mutation Path

Every meaningful write should follow one consistent path:

1. mutate the authoritative owner system
2. derive the necessary read or render state
3. persist only through the canonical persistence boundary when needed

Do not create a second mutation system for "simple" cases.

## Architecture Standards

### 1. Clear Ownership Boundaries

Keep separate:

- agent-os state
- runner contracts
- channel rendering
- control actions
- configuration state

### 2. Backend-Agnostic Agent-OS

Agent-OS must be able to survive a future runner swap.

Do not let tmux-only assumptions become Agent-OS contracts.

Do not collapse `agentId` and `sessionKey` into one identity.

### 3. Standard Runner Contract

Every runner should converge on the same internal contract for:

- input submission
- output capture
- snapshot access
- streaming updates
- lifecycle and error signals

### 4. Channel-Owned Presentation

Raw session output is not automatically user-facing output.

Channel rendering owns:

- transcript shaping
- chunking
- header and footer stripping
- chat-first default interaction behavior
- explicit transcript request behavior

### 5. Package Independence

Each major module should be understandable without hidden dependence on unrelated internal systems.

## What To Be Strict About

- stable ids
- clear ownership
- one authoritative mutation path
- one canonical owner per state transition
- documented boundary exceptions

## What To Delay

- premature channel proliferation before Slack and API contracts are stable
- hidden coupling between agent-os and runner details
- hidden coupling between channel UX and control workflows

Build the right boundaries first.
