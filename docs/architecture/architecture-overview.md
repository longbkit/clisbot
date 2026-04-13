# clisbot Architecture Overview

## Document Information

- **Created**: 2026-04-04
- **Purpose**: Show the top-level system shape and link to the governing architecture docs
- **Status**: Working architecture

## Governing References

Read this file as the map, then use the detail docs for the actual contract:

- [Surface Architecture](surface-architecture.md)
- [Runtime Architecture](runtime-architecture.md)
- [Model Taxonomy And Boundaries](model-taxonomy-and-boundaries.md)

If this overview and a detailed architecture doc diverge, the detailed doc wins.

## Core Decision

Keep the system split into five explicit product systems:

- channels
- control
- configuration
- agents
- runners

That boundary is the main architecture rule for the repository.

## Top-Level Diagram

```text
                                 clisbot

    Humans / clients                           Operators
           |                                      |
           v                                      v
+----------------------+              +----------------------+
|      CHANNELS        |              |       CONTROL        |
|----------------------|              |----------------------|
| Slack                |              | start / stop         |
| Telegram             |              | status / logs        |
| future API / Discord |              | channels / agents    |
|                      |              | pairing / debug      |
|                      |              | permissions          |
| owns:                |              | owns:                |
| - inbound messages   |              | - inspect            |
| - thread / reply UX  |              | - intervene          |
| - chat-first render  |              | - operator views     |
| - transcript command |              | - operator permissions |
+----------+-----------+              +----------+-----------+
           |                                     |
           +------------------+------------------+
                              |
                              v
                    +----------------------+
                    |    CONFIGURATION     |
                    |----------------------|
                    | clisbot.json          |
                    | env vars             |
                    | route mapping        |
                    | agent defs           |
                    | policy flags         |
                    | workspace defaults   |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |        AGENTS        |
                    |----------------------|
                    | backend-agnostic     |
                    |                      |
                    | owns:                |
                    | - agent identity     |
                    | - session keys       |
                    | - workspaces         |
                    | - queueing           |
                    | - lifecycle state    |
                    | - follow-up state    |
                    | - memory / tools     |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |       RUNNERS        |
                    |----------------------|
                    | normalize backend    |
                    | quirks into one      |
                    | internal contract    |
                    |                      |
                    | contract:            |
                    | - start / stop       |
                    | - submit input       |
                    | - capture snapshot   |
                    | - stream updates     |
                    | - lifecycle / errors |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |    tmux runner now   |
                    |----------------------|
                    | native CLI in tmux   |
                    | Codex / Claude / ... |
                    | session-id capture   |
                    | resume / relaunch    |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |   Durable runtime    |
                    |----------------------|
                    | tmux sessions        |
                    | workspaces           |
                    | CLI processes        |
                    +----------------------+
```

## Default Flow

```text
user message
  -> channel
  -> configuration resolves route + policy
  -> agents resolves agent + session key
  -> runner executes native CLI
  -> channel renders clean chat-first output
  -> control can inspect or intervene separately
```

## Persistence Rule

Persist only what must survive restarts.

Current durable examples:

- config
- processed event state
- session continuity metadata

Current session continuity metadata is intentionally small:

- `sessionKey`
- `agentId`
- `sessionId`
- `workspacePath`
- `runnerCommand`
- `updatedAt`

Do not treat tmux pane ids, tmux window ids, or other transient runner artifacts as canonical state in the agents layer.

## Ownership Rules

- Channels own user-facing interaction and presentation.
- Control owns operator-facing inspection, intervention, and permission handling.
- Configuration is the local control plane that wires the system together and stores the relevant policy config.
- The agents layer owns backend-agnostic agent, session, and workspace behavior.
- Runners own backend-specific execution behavior and normalize quirks behind one contract.

## Why This Split Matters

If these systems blur together:

- backend quirks leak into product logic
- operator workflows drift into user-facing channels
- testing gets weaker because boundaries disappear
- future runner swaps become expensive
- the codebase becomes harder to refactor safely

## Detail Docs

- Use [surface-architecture.md](surface-architecture.md) for user-facing and operator-facing surface rules.
- Use [runtime-architecture.md](runtime-architecture.md) for agents, runner, persistence, and runtime contract rules.
- Use [model-taxonomy-and-boundaries.md](model-taxonomy-and-boundaries.md) for model ownership, lifecycle, and naming boundaries.
