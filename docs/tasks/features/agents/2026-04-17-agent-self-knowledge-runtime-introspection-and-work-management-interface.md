# Agent Self-Knowledge, Runtime Introspection, And Work-Management Interface

## Summary

Expand the `agents` layer so `clisbot` can act less like a prompt-forwarding bot and more like a capable work agent.

This task defines three linked growth tracks:

1. agent self-knowledge and context bootstrap
2. agent runtime introspection and control bridge
3. agent work-management interface

The goal is to make the bot understand who it is, what it can do, what is happening in its own runtime, and how to manage work through a clean interface instead of a context dump.

## Status

Ready

## Why This Task Exists

`clisbot` already has real workspaces, route-aware channels, runtime state, loops, queueing, and operator controls.

But the system still lacks one coherent agent-facing model that lets the bot:

- understand its own documented identity, limits, and capabilities
- inspect its current runtime state truthfully
- read and mutate work items through a stable interface

Without that layer, the bot remains too dependent on raw prompt stuffing and human operator intervention.

## Architecture Placement

This belongs in `agents`, not in `channels` or `control`.

Why:

- `channels` own transport, routing, and rendering
- `control` owns operator-facing intervention surfaces
- `agents` own the backend-agnostic operating model, memory, tools, queueing, session policy, and agent-callable actions

The work-management part starts here as an agent-facing interface.
If it later grows into a large resource system with multiple backend adapters and its own projections or permissions, it can split into a separate feature area such as `work-management`.

## Workstream 1: Agent Self-Knowledge And Context Bootstrap

### Goal

Give the agent a truthful, bounded way to understand:

- who it is
- what repo or workspace it is in
- what docs define its role
- what commands and tools it can use
- what limits or guardrails apply

### Scope

- context bootstrap from files such as `AGENTS.md`, `README.md`, feature docs, and workspace memory
- explicit capability summaries instead of relying only on large raw prompt dumps
- first-principles identity model for role, scope, limits, and ownership
- current-environment facts that the agent can inspect truthfully

### Questions To Answer

1. What belongs in durable identity versus session-scoped context?
2. Which docs are source of truth versus supporting context?
3. How much context should be summarized into capability models versus injected as raw text?
4. How does the agent learn what tools, channels, and control bridges exist right now?

## Workstream 2: Agent Runtime Introspection And Control Bridge

### Goal

Give the agent a standard way to inspect and change its own runtime state where policy allows.

Examples:

- active run state
- queued follow-up prompts
- recurring loops
- follow-up policy
- observer state
- route-local runtime mode

### Scope

- canonical agent-facing read interfaces for runtime state
- canonical agent-facing mutation interfaces for allowed runtime controls
- separation between operator control and agent self-management
- truthful runtime summaries for queue, loops, active run, and session state

### Questions To Answer

1. Which runtime state may the agent read?
2. Which runtime state may the agent mutate directly?
3. Which changes require auth or policy checks before the agent can invoke them?
4. How do these interfaces stay backend-agnostic and not leak tmux details?

## Workstream 3: Agent Work-Management Interface

### Goal

Give the agent a normalized way to manage work items so backend choice can vary without changing the agent contract.

Examples of possible backends:

- local file workflow
- CLI-backed task workflow
- Jira
- Notion
- future plugins

### Scope

- define a backend-agnostic task or work-item interface
- define read, create, update, close, and query semantics
- define adapter boundaries for external backends
- define what minimal work graph or task model the agent needs
- define permission, sync, and observability expectations

## Related Follow-Up Tasks

- [Agent-Managed Queue Workflow And Queues CLI](2026-04-28-agent-managed-queue-workflow-and-queues-cli.md)

### Questions To Answer

1. What is the minimum stable work-item model?
2. Which operations must be universal across backends?
3. What belongs in agent contract versus backend adapter translation?
4. When does this outgrow `agents` and deserve its own `work-management` feature area?

## Non-Goals

- implementing every external backend now
- moving operator CLI surfaces into agent chat UX
- adding a new feature area before the interface contract is clear
- stuffing more raw docs into prompts without a model for why

## Proposed Deliverables

- one agent-facing context and capability model
- one runtime introspection and control bridge contract
- one backend-agnostic work-management interface contract
- follow-up implementation slices for the highest-value parts

## Initial Subtasks

- [ ] define the canonical self-knowledge model and source precedence
- [ ] define the minimal capability summary the agent should be able to inspect
- [ ] define the agent-facing runtime introspection contract
- [ ] define the agent-facing runtime mutation contract and policy gates
- [ ] define the minimal work-item model and adapter contract
- [ ] define when work-management should split into its own feature area
- [ ] split the implementation backlog into thin vertical slices

## Exit Criteria

- a reviewer can explain why this work belongs to `agents`
- the three workstreams have clear boundaries and do not collapse into one vague “smarter bot” bucket
- backend-agnostic interfaces are defined before implementation-heavy work starts
- future work-management split criteria are written down explicitly

## Related Docs

- [Agents Feature](../../../features/agents/README.md)
- [Control Feature](../../../features/control/README.md)
- [Configuration Feature](../../../features/configuration/README.md)
- [Model Taxonomy And Boundaries](../../../architecture/model-taxonomy-and-boundaries.md)
- [Conversation Follow-Up Policy And Runtime Control API](2026-04-05-conversation-follow-up-policy-and-runtime-control-api.md)
