# Agent-Managed Queue Workflow And Queues CLI

## Summary

Add a first-class queue creation/control surface similar to managed loops, but
for one-shot follow-up prompts in the same routed session.

The key product goal is to let an agent plan its own next prompts while it is
already working:

```text
current run decides useful next steps
  -> creates queued prompt entries
  -> clisbot runs them one by one in the same session
  -> each queued prompt rebuilds the current prompt envelope at start time
```

Unlike loop creation, queue creation does not need a new-thread mode. A queue is
session-local follow-up work, not a new conversation anchor.

## Status

Planned

## Priority

P0

## Why

`/queue` already lets a human stack one follow-up message behind the active run.
`/loop` already has a stronger control-plane shape: persisted state, CLI
creation, scoped list/status/cancel, and agent prompt guidance that tells future
agents to inspect `clisbot loops --help`.

The missing piece is the same leverage for queues:

- an agent should be able to enqueue the next concrete prompts it determines are
  valuable
- the user should not have to babysit every continuation prompt
- queued work should survive the same operational boundaries as the rest of the
  session model where practical
- queue control should be inspectable and clearable from chat and CLI

This belongs in `agents` because queueing is part of the backend-agnostic agent
session operating model. `channels` should only own command parsing, prompt
envelope rendering, and visible queue notifications. `control` should own the
operator CLI surface.

## Current Baseline

- Chat `/queue <message>` and `\q <message>` enqueue one prompt in memory for the
  current session.
- `/queue list` and `/queue clear` inspect or clear pending in-memory items for
  the current session.
- `additionalMessageMode: "queue"` can route later human messages into the same
  queue path while a session is busy.
- Queue-start notifications already exist through
  `surfaceNotifications.queueStart`.
- Queue entries preserve the sender/surface context and rebuild the prompt
  envelope when the queued item starts.
- There is no durable one-shot queue store.
- There is no `clisbot queues` CLI comparable to `clisbot loops`.
- There is no agent-facing current-session queue command for self-planned
  follow-up prompts.

## Target Product Contract

### Chat

- Keep `/queue <message>`, `/queue list`, and `/queue clear`.
- Add `/queue status` as an alias for list plus active/running summary if useful.
- Keep `/queue clear` scoped to the current routed session by default.
- Do not add `/queue --new-thread`; queue items always target the current
  session.

### Control CLI

Add a `clisbot queues` namespace:

- `clisbot queues list`
- `clisbot queues status`
- `clisbot queues create --channel telegram --target -100... --topic-id 1 --sender telegram:1276408333 <prompt>`
- `clisbot queues create --channel slack --target group:C123 --thread-id 171... --sender slack:U123 <prompt>`
- `clisbot queues create --session-key <sessionKey> --sender <principal> <prompt>`
- `clisbot queues clear --channel ... --target ...`
- `clisbot queues clear --session-key <sessionKey>`
- `clisbot queues clear --all`

The CLI should reuse loop addressing helpers where possible, but not inherit
loop schedule or new-thread semantics.

### Agent-Facing Self-Queue

Give the active runner a narrow way to enqueue work for its own current session:

- expose current execution context to the runner process or wrapper:
  - `CLISBOT_AGENT_ID`
  - `CLISBOT_SESSION_KEY`
  - `CLISBOT_SENDER_ID`
  - `CLISBOT_SURFACE_ID` or equivalent surface binding handle
- document an agent-safe command:
  - `clisbot queues create --current <prompt>`
- `--current` must resolve only to the current session context.
- The command must not let the agent silently enqueue work into another channel,
  group, topic, DM, or thread.
- The queued prompt stores canonical prompt text, creator metadata, and surface
  binding. It must not store a pre-rendered prompt envelope.

### Prompt Guidance

Update normal prompt guidance so agents learn the new primitive:

```text
For follow-up work in this same conversation, use `clisbot queues --help`.
Use `clisbot queues create --current <prompt>` when you need to queue concrete
next prompts instead of stopping early.
```

Do not encourage queue creation for every task. The guidance should frame it as
a continuation tool for clear next steps, not a default behavior.

## Architecture Invariants

- `agents` owns queued work as session state.
- `channels` owns `/queue` parsing, channel-visible acknowledgments, and final
  delivery rendering.
- `control` owns `clisbot queues ...` commands and operator output.
- `auth` owns permission checks for cross-session or operator-created queue
  mutations.
- `runners` only receive prompts; runners do not know queue persistence details.
- Queue entries store canonical user/agent prompt text, not wrapped envelopes.
- Queue execution rebuilds prompt context at start time using the same
  sender/surface contract as normal, queued, and loop messages.
- Current-session self-queue must be constrained by the active prompt context,
  not by ambient shell state alone.
- Queue state must not use tmux panes, tmux windows, or transient runner process
  ids as canonical identity.

## Safety And Limits

- Add a per-session pending queue limit.
- Add a per-run self-queue creation budget so a single prompt cannot create an
  unbounded continuation chain.
- Add an app-level max pending queue limit to avoid global buildup.
- `skip-if-busy` does not apply to one-shot queues; queue order is the product
  contract.
- Clearing pending queue items must not interrupt the currently running item.
- Self-queued prompts should be visibly attributed as agent-created follow-up
  work, while preserving the original sender/surface reply target.
- If the runtime is stopped, persisted queue items should wait until startup or
  explicit clear; they should not run from a short-lived CLI process.

## Implementation Slices

### 1. Model And Persistence

- define `StoredQueueItem`
- store queue items inside the session entry, next to loop state
- include:
  - `id`
  - `agentId`
  - `sessionKey`
  - `createdAt`
  - `updatedAt`
  - `promptText`
  - `promptSummary`
  - `createdBy`
  - `createdByKind: "human" | "agent" | "operator"`
  - sender metadata
  - surface binding
  - execution state: `pending`, `running`, `completed`, `failed`, `cleared`
- migrate in-memory queue listing to read the same canonical state where
  possible
- keep transient promise/deferred machinery out of persistence

### 2. Runtime Reconciliation

- make the live runtime reconcile persisted queue items after startup
- make the live runtime reconcile queue items created by `clisbot queues create`
  without restart, following the loop reconciliation pattern
- ensure only one queue drain owner runs per session
- keep active-run state authoritative: no queued item starts while a run is
  already running for the same session

### 3. Control CLI

- add `src/control/queues-cli.ts`
- reuse route/session addressing helpers from loops where DRY
- require `--sender` for cross-session queue creation
- support `--current` only when current-session environment is present
- add readable list/status/clear output
- add JSON output only if existing control CLI conventions require it

### 4. Chat Command Alignment

- keep current `/queue` UX compatible
- route `/queue <message>` through the same stored queue path as CLI-created
  queue items
- keep `/queue list` and `/queue clear` truthful after persistence
- make queue-start notifications work for persisted queue items

### 5. Agent Prompt And Docs

- update prompt guidance to mention `clisbot queues --help`
- update [Agent Commands](../../../features/agents/commands.md)
- update [Slash Commands](../../../user-guide/slash-commands.md)
- add a user-guide section for self-queue use and limits
- link this task from the broader
  [Agent Self-Knowledge, Runtime Introspection, And Work-Management Interface](2026-04-17-agent-self-knowledge-runtime-introspection-and-work-management-interface.md)

### 6. Tests

- queue model persists pending items by session
- `/queue <message>` creates the same stored queue item shape as CLI creation
- `clisbot queues create --current` fails without current-session context
- `clisbot queues create --current` cannot target another session
- scoped CLI queue creation requires `--sender`
- runtime startup drains persisted queue items in order
- runtime reconciliation picks up CLI-created queue items without restart
- clearing pending queue items rejects/skips only pending items
- queue-start notification still includes a compact prompt summary
- self-queue budget prevents runaway queue chains

## Open Questions

- Should completed/failed queue history stay in session state briefly for
  inspection, or should only pending/running items be persisted?
- Should self-queued prompts inherit the original human sender for auth, or use a
  separate agent principal with an audit link to the original sender?
- Should queue limits live under `app.control.queue`, agent defaults, route
  policy, or all three with normal precedence?
- Should `clisbot queues create --current` be allowed only from the runner
  wrapper environment, or also from `/bash` in the same session?

## Exit Criteria

- Agents can enqueue concrete same-session follow-up prompts through an
  documented current-session command.
- Operators can inspect, create, and clear queue items through `clisbot queues`.
- Chat `/queue` and CLI queue creation share one model and one runtime drain
  path.
- Queue state is durable enough to survive runtime restart.
- The architecture docs remain truthful: agents own queue state, channels own
  presentation, control owns CLI inspection/mutation, and runners stay
  backend-agnostic.
