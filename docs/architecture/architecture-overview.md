# clisbot Architecture Overview

## Document Information

- **Created**: 2026-04-04
- **Purpose**: Show the top-level system shape and link to the governing architecture docs
- **Status**: Working architecture

## Governing References

Read this file as the map, then use the detail docs for the actual contract:

- [Surface Architecture](surface-architecture.md)
- [Runtime Architecture](runtime-architecture.md)
- [Domain Language](domain-language.md)

If this overview and a detailed architecture doc diverge, the detailed doc wins.

## Core Decision

Keep the system split into six explicit product systems:

- channels
- auth
- control
- configuration
- agents
- runners

That boundary is the main architecture rule for the repository.

`src/infra` is the only non-product infra layer. It may hold small
host/runtime primitives such as filesystem helpers, path defaults, process
helpers, and runtime logging. Product concepts do not belong there; they should
live under the system that owns their behavior.

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
|                      |              | gated actions        |
| owns:                |              | owns:                |
| - inbound messages   |              | - inspect            |
| - thread / reply UX  |              | - intervene          |
| - chat-first render  |              | - operator views     |
| - transcript command |              | - operator intervention |
+----------+-----------+              +----------+-----------+
           |                                     |
           +------------------+------------------+
                              |
                              v
                    +----------------------+
                    |    CONFIGURATION     |
                    |----------------------|
                    | clisbot.json         |
                    | env vars             |
                    | route mapping        |
                    | agent defs           |
                    | policy storage       |
                    | workspace defaults   |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |         AUTH         |
                    |----------------------|
                    | roles / permissions  |
                    | owner claim          |
                    | resolution order     |
                    | enforcement contract |
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
  -> configuration resolves route + persisted policy inputs
  -> auth resolves effective permissions
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
- `runtime`
- `loops`
- `queues`
- `recentConversation`
- `updatedAt`

Do not treat tmux pane ids, tmux window ids, or other transient runner artifacts as canonical state in the agents layer.

## Ownership Rules

- Channels own user-facing interaction and presentation.
- Auth owns permission semantics, owner claim, and the contract between advisory and enforced behavior.
- Control owns operator-facing inspection and intervention surfaces, and consumes auth rules for operator checks.
- Configuration is the local control plane that wires the system together and stores the relevant policy config.
- The agents layer owns backend-agnostic agent, session, and workspace behavior.
- Runners own backend-specific execution behavior and normalize quirks behind one contract.

Current runtime naming should reflect that split clearly:

- `AgentService` is a thin facade at the runtime entrypoint
- `SessionService` is the session-owned runtime owner in `agents`
- `RunnerService` is the backend-owned runtime owner in `runners`

Current code is not fully converged on that split yet:

- `src/agents/runtime/runner-service.ts` still holds the `RunnerService`
  implementation today
- that file still carries some `SessionService`-owned continuity work
- treat the owner map above as the architecture target, not as a claim that
  file placement and continuity boundaries are already fully clean

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
- Use [domain-language.md](domain-language.md) for canonical vocabulary, model ownership, lifecycle, and naming boundaries.
