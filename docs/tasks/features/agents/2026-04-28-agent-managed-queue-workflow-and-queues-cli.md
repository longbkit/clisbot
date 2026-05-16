# Queue Workflow And Queues CLI

## Summary

Add a first-class queue creation/control surface similar to managed loops, but
for one-shot follow-up prompts in the same routed session.

The key product goal is to make one-shot follow-up work durable and inspectable
through the same routed-session control model as loops:

```text
human chat command or operator CLI creates queued prompt entries
  -> clisbot runs them one by one in the same session
  -> each queued prompt rebuilds the current prompt envelope at start time
```

Unlike loop creation, queue creation does not need a new-thread mode. A queue is
session-local follow-up work, not a new conversation anchor.

## Status

Done

## Priority

P0

## Why

`/queue` already lets a human stack one follow-up message behind the active run.
`/loop` already has a stronger control-plane shape: persisted state, CLI
creation, scoped list/status/cancel, and agent prompt guidance that tells future
agents to inspect `clisbot loops --help`.

The missing piece is the same leverage for queues:

- the user should not have to babysit every continuation prompt
- queued work should survive the same operational boundaries as the rest of the
  session model where practical
- queue control should be inspectable and clearable from chat and CLI

This belongs in `agents` because queueing is part of the backend-agnostic agent
session operating model. `channels` should only own command parsing, prompt
envelope rendering, and visible queue notifications. `control` should own the
operator CLI surface.

## Pre-Implementation Baseline

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

## Implementation Summary

Implemented on 2026-04-29.

- Added `StoredSessionEntry.queues?: StoredQueueItem[]` in the existing
  session store.
- Added durable queue item metadata for prompt text,
  sender, surface binding, lifecycle status, and prompt summary.
- Made `StoredSessionEntry.queues` the canonical queue inventory for `/queue`
  and `clisbot queues`; the runtime hydrates those items into one ordered drain
  instead of keeping a separate legacy queue inventory.
- Made `/queue <message>` and route `additionalMessageMode: "queue"` create the
  same stored queue item shape used by CLI-created queue items.
- Added runtime reconciliation so `clisbot queues create` writes are picked up
  by the live runtime without restart.
- Added startup handling that resets stale `running` queue items back to
  `pending` when no active runtime exists for that session.
- Added `clisbot queues list|status|create|clear`.
- Added agent prompt guidance pointing future agents to `clisbot queues --help`
  for durable queue inspection and one-shot queued prompts.
- Kept `list` pending-only and `clear` pending-only.
- Added `control.queue.maxPendingItemsPerSession`, defaulting to `20` when
  omitted from config. The default template intentionally omits this key so the
  release default can evolve.
- Runtime-reconciled queue items use stored sender/surface metadata for
  queue-start notifications and terminal settlement notifications.
- Kept bash execution on its own `${sessionKey}:bash` in-memory key and out of
  durable prompt queue persistence.

## Pre-Implementation Queue Semantics To Preserve

The durable queue work must not drift from the pre-existing runtime behavior.
At minimum, every existing channel delivery semantic below must survive while
the durable `StoredSessionEntry.queues` inventory becomes canonical.

### Storage And Identity Today

- queue state is in memory only, inside `AgentJobQueue.states`
- the map key is usually `target.sessionKey`
- shell execution uses a separate sub-key: `${sessionKey}:bash`
- queue ids are process-local incrementing strings, not durable ids
- restarting the runtime drops all pending queue entries
- current queue state is not stored in `session.storePath`
- current queue state is not part of `StoredSessionEntry`

### Per-Key Ordering And Concurrency

- jobs with the same queue key run serially
- jobs with different keys run concurrently
- enqueue returns `positionAhead` equal to the number of entries already in that
  key before the new entry is pushed
- `positionAhead` drives user-visible queued/running placeholders such as
  `Queued: 1 ahead`
- a single drain loop owns one key while `QueueState.running` is true
- the drain loop always picks the first pending entry
- a pending entry whose `canStart` returns false blocks later pending entries;
  later entries must not bypass it
- `canStart` is polled with the queue pending poll interval until it allows the
  entry to run

### Prompt Queue Admission

- `AgentService.enqueuePrompt` queues under `target.sessionKey`
- prompt queue entries use `canStart` to wait until
  `activeRuns.hasLiveActiveRun(target)` is false
- queued prompts therefore do not start while a logical active run is still live
- this guard must keep working for detached observer cases where the visible
  observer is gone but the active run is not truly idle
- prompt text may be a function; the function is evaluated only when the queue
  entry starts
- lazy prompt evaluation lets queued and route-queued prompts rebuild the prompt
  envelope at execution time instead of freezing a stale wrapped prompt
- the stored list text is `callbacks.queueText`, falling back to prompt text
  only when the prompt is already a string

### Bash Queue Semantics

- `runShellCommand` queues under `${sessionKey}:bash`
- bash jobs serialize with other bash jobs for the same session
- bash jobs do not use the prompt queue key directly
- `isBusy(sessionKey)` treats both the exact session key and keys prefixed with
  `${sessionKey}:` as busy, so bash sub-queue work still makes the session busy
  for follow-up routing
- durable queue work must not accidentally merge bash command execution with
  prompt queue persistence unless that is a deliberate separate design

### List And Clear Semantics

- `listQueuedPrompts(target)` calls `listPending(target.sessionKey)`
- list output shows pending entries only
- running entries are intentionally not listed as pending queued messages
- entries without `text` are not shown by list
- listed fields today are only `id`, `text`, and `createdAt`
- `/queue list` renders numbered text plus `queuedAt`
- `clearQueuedPrompts(target)` clears only pending entries for
  `target.sessionKey`
- clear keeps the currently running entry
- clear rejects every removed pending entry with `ClearedQueuedTaskError`
- clearing pending entries must settle waiting callers; it must not leave a
  queued execution promise hanging
- the queue state is removed from memory when no entries remain and no drain is
  running

### Channel Delivery Semantics

- `/queue <message>` and `\q <message>` request queued execution for that one
  message
- when `additionalMessageMode` is `queue` and the session is busy, normal
  follow-up messages also use queued execution
- explicit queue messages and route-queued messages pass `queueText` separately
  from the generated prompt envelope
- queue start notifications use `queueText` or the notification prompt summary,
  not an arbitrary stale wrapper
- queue start notifications are rendered when a queued item actually starts
  running, not merely when it is accepted into the queue
- `surfaceNotifications.queueStart` controls whether the notification is
  rendered and how much summary text it contains
- streaming-off routes still need truthful final settlement and must not require
  a visible interim queued placeholder
- message-tool routes must preserve preview handoff and final-marker
  settlement behavior instead of forcing queued work into pane-managed
  rendering
- explicit `/queue` requests queued execution only; it must not force the
  output delivery mode away from `message-tool`
- route-queued prompt envelopes are rebuilt when the queued item starts

### Busy And Follow-Up Semantics

- `isSessionBusy` is true when there is a live active run or queue work for the
  session
- `isAwaitingFollowUpRouting` returns true while the queue is busy
- follow-up routing must not auto-steer into a session just because the visible
  final reply state is confusing while queued work remains
- after a final reply boundary, normal new prompts should not be treated as
  steering solely because an old active-run record exists

### Error And Settlement Semantics

- task success resolves the queued result promise
- task failure rejects the queued result promise
- clearing pending work rejects with `ClearedQueuedTaskError`
- channel settlement treats `ClearedQueuedTaskError` as a cleared queued item,
  not as an ordinary runner failure
- any durable replacement needs an equivalent settlement path for pending items
  cleared before execution

## Queue Compared To Loops

Queues and loops should share the same persistence boundary:

- both live under one `StoredSessionEntry` in `session.storePath`
- both are scoped by `sessionKey`, not by tmux pane, process id, or transient
  runner state
- both persist prompt text plus sender and surface metadata, then
  rebuild the prompt envelope at execution time
- both use control CLI commands for operator inspection and mutation

The difference is scheduling:

- loops store schedule state such as interval, calendar cadence, next run, and
  run counters
- queues store ordered one-shot work items such as position, lifecycle state,
  and prompt metadata
- loops may skip ticks when busy; queues preserve order and wait behind the
  active run

Loop state currently persists as `loops?: StoredLoop[]` on the session entry,
with `intervalLoops` retained only as compatibility input. Queue state should
follow the same model with a `queues?: StoredQueueItem[]` field on the session
entry. It should not be a separate top-level store unless the session store
model proves insufficient.

## Persistence Contract

Yes: the new queue state should become durable. The target persisted home is the
existing session store:

```text
session.storePath
  -> Record<sessionKey, StoredSessionEntry>
  -> StoredSessionEntry.queues?: StoredQueueItem[]
```

Persistence and runtime queueing must be one contract. The persisted `queues`
array is the inventory and recovery source; the in-process queue is only the
ordered drain for pending/running work already represented in that durable
inventory.

### Write Scope And Conflict Control

- Persist queue state only on session-scoped mutations.
- Do not rewrite unrelated session entries when one session queue changes.
- Do not rewrite unrelated fields in the same session entry when only queue
  state changes.
- Use one compare/update path for queue item transitions so CLI writes,
  runtime reconciliation, clear operations, and active-run settlement do not
  recreate stale items.
- Treat queue item lifecycle updates as small targeted writes:
  - append pending item
  - claim `pending -> running`
  - remove after `running` settles
  - clear by removing pending items
- Runtime timers or progress updates must not persist on every stream chunk.
  Queue persistence should happen on admission, claim, terminal settlement,
  and clear.
- CLI-created queue items should be persisted and then picked up by the live
  runtime reconciliation loop; the short-lived CLI process must not execute
  prompt delivery itself.
- Reconciliation should scan cheaply and claim only eligible pending queue
  items. It should not drain every session store entry through a heavyweight
  write loop when no queue state changed.
- Keep the in-memory drain fast. Persistence is durability and coordination, not
  a per-poll bottleneck for `canStart`.

### Claim And Restart Semantics

- `pending -> running` must be an explicit claim tied to one runtime owner.
- If startup finds an old `running` item without a live active run, it resets it
  to `pending` so the runtime can retry deterministically.
- If startup finds `running` with a matching live active run, it must not start
  a duplicate run.
- A cleared pending item must settle like current `ClearedQueuedTaskError` so
  callers and channel delivery do not hang.
- The persisted model must preserve the current order semantics even across
  restart; later pending items must not overtake an earlier pending item that is
  blocked by active-run state.

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
- `clisbot queues list --channel slack --target group:C123 --thread-id 171...`
- `clisbot queues list --channel telegram --target group:-1001234567890 --topic-id 42`
- `clisbot queues status`
- `clisbot queues status --channel slack --target group:C123 --thread-id 171...`
- `clisbot queues status --channel telegram --target group:-1001234567890 --topic-id 42`
- `clisbot queues create --channel telegram --target group:-1001234567890 --topic-id 42 --sender telegram:1276408333 <prompt>`
- `clisbot queues create --channel slack --target group:C123 --thread-id 171... --sender slack:U123 <prompt>`
- `clisbot queues clear --channel ... --target ...`
- `clisbot queues clear --all`

Bare `list` and `status` are app-wide inventory. Scoped `list` and `status`
must accept the same routed target shape as queue `create`. Scoped `status` may
add active/running summary, but scoped `list` must still be available for
filtered inventory.

The CLI should reuse loop addressing helpers where possible, but not inherit
loop schedule or new-thread semantics. Telegram examples must use canonical
route target syntax such as `group:-1001234567890` plus `--topic-id` for topic
targeting, not a bare raw chat id. If loop creation still accepts bare numeric
Telegram chat ids for compatibility, queue CLI docs should treat that as a
compatibility input, not the preferred contract.

Do not add `clisbot queues create --current`. Loops do not have an equivalent
ambient current-session create mode, and queueing through ambient runner context
adds avoidable ambiguity around sender, route, surface, and auth. Queue creation
must match `loops create`: use explicit routed addressing plus `--sender`, so
the queued item has the same metadata quality as CLI-created loops and can
still rebuild the prompt envelope and notify the surface.
Keep queue CLI addressing on `--channel/--target`; that already addresses the
same routed surfaces and avoids introducing parallel concepts.

### Prompt Guidance

Update normal prompt guidance so agents know how to inspect the operator
surface without implying ambient self-queue support:

```text
For queue inspection or operator-created follow-up work, use
`clisbot queues --help`. Queue creation requires explicit routed addressing
plus `--sender`; there is no `--current` shortcut, and queue commands use
`--channel/--target` addressing.
```

Do not encourage queue creation for every task. The guidance should frame the
CLI as an operator control surface, similar to loops, not as an automatic
self-continuation tool.

## Architecture Invariants

- `agents` owns queued work as session state.
- `channels` owns `/queue` parsing, channel-visible acknowledgments, and final
  delivery rendering.
- `control` owns `clisbot queues ...` commands and operator output.
- `auth` owns permission checks for cross-session or operator-created queue
  mutations.
- `runners` only receive prompts; runners do not know queue persistence details.
- Queue entries store prompt text as the durable source prompt, not wrapped envelopes.
- Queue execution rebuilds prompt context at start time using the same
  sender/surface contract as normal, queued, and loop messages.
- Queue state must not use tmux panes, tmux windows, or transient runner process
  ids as canonical identity.
- Queue CLI creation requires explicit sender and target metadata; ambient
  current-session inference is not part of the contract.

## Safety And Limits

- Add a per-session pending queue limit:
  `control.queue.maxPendingItemsPerSession`, default `20`.
- `skip-if-busy` does not apply to one-shot queues; queue order is the product
  contract.
- Clearing pending queue items must not interrupt the currently running item.
- CLI-created queued prompts should be visibly attributed as operator-created
  follow-up work, while preserving the configured sender/surface reply target.
- If the runtime is stopped, persisted queue items should wait until startup or
  explicit clear; they should not run from a short-lived CLI process.

## Implementation Slices

### 1. Model And Persistence

- define `StoredQueueItem`
- store queue items inside the session entry, next to loop state
- mirror loop metadata where the concepts match:
  - `id`
  - `createdAt`
  - `updatedAt`
  - `promptText`
  - `protectedControlMutationRule`
  - `promptSummary`
  - `createdBy`
  - `sender`
  - `surfaceBinding`
- add queue-specific fields:
  - `status: "pending" | "running"`
  - `startedAt`
- migrate in-memory queue listing to read the same canonical state where
  possible
- keep transient promise/deferred machinery out of persistence

### 2. Runtime Reconciliation

- make the live runtime reconcile persisted queue items after startup
- make the live runtime reconcile queue items created by `clisbot queues create`
  without restart, following the loop reconciliation pattern
- ensure only one queue drain owner runs per session
- claim persisted queue items before execution and make stale `running`
  recovery deterministic
- avoid high-conflict writes by persisting only queue admission, claim,
  terminal settlement, clear, and bounded cleanup transitions
- keep active-run state authoritative: no queued item starts while a run is
  already running for the same session

### 3. Control CLI

- add `src/control/commands/queues-cli.ts`
- reuse route/session addressing helpers from loops where DRY
- support scoped `list` and `status` with `--channel --target` filters
- require `--sender` for cross-session queue creation
- do not support `--current`
- add readable list/status/clear output
- add JSON output only if existing control CLI conventions require it

### 4. Chat Command Alignment

- keep current `/queue` UX compatible
- route `/queue <message>` through the same stored queue path as CLI-created
  queue items
- keep `/queue list` and `/queue clear` truthful after persistence
- make queue-start notifications work for persisted queue items
- make terminal settlement notifications work for runtime-reconciled queue
  items so CLI-created queue items do not require a live chat observer from the
  short-lived CLI process

### 5. Prompt Guidance And Docs

- update prompt guidance to mention `clisbot queues --help` for queue
  inspection and explicit operator-created follow-up work
- update [Agent Commands](../../../features/agents/commands.md)
- update [Slash Commands](../../../user-guide/slash-commands.md)
- add a user-guide section for queue CLI metadata, storage, scoped inspection,
  and limits
- link this task from the broader
  [Agent Self-Knowledge, Runtime Introspection, And Work-Management Interface](2026-04-17-agent-self-knowledge-runtime-introspection-and-work-management-interface.md)

### 6. Tests

- queue model persists pending items by session
- `/queue <message>` creates the same stored queue item shape as CLI creation
- durable queue preserves every behavior listed in
  [Current Queue Semantics To Preserve](#current-queue-semantics-to-preserve)
- scoped `clisbot queues list` and `clisbot queues status` filter one routed
  session or canonical surface without hiding app-wide inventory behavior
- help does not advertise `clisbot queues create --current`
- scoped CLI queue creation requires `--sender`
- queue items persist sender and surface metadata comparable to stored loops
- queue persistence uses targeted session-scoped transitions and does not add a
  per-stream-update or per-`canStart` write bottleneck
- runtime startup drains persisted queue items in order
- runtime reconciliation picks up CLI-created queue items without restart
- clearing pending queue items rejects/skips only pending items
- queue-start notification still includes a compact prompt summary
- queue creation enforces `control.queue.maxPendingItemsPerSession`

## Retained Non-Goals

- Completed/failed queue item history is not retained. Settled queue items are
  removed, matching the old pending-queue mental model.
- App-wide and route-level queue limits are not part of this slice.

## Exit Criteria

- Operators can inspect, create, and clear queue items through `clisbot queues`.
- `clisbot queues list` and `clisbot queues status` both support app-wide and
  scoped inspection.
- Chat `/queue` and CLI queue creation share one model and one runtime drain
  path.
- Queue state is durable enough to survive runtime restart.
- The architecture docs remain truthful: agents own queue state, channels own
  presentation, control owns CLI inspection/mutation, and runners stay
  backend-agnostic.

## Related Follow-Up

`clisbot loops status --channel ... --target ...` already supports scoped
inspection. `clisbot loops list` should gain the same scoped filter shape so
operators and agents do not have to remember that only `status` can narrow by a
specific group, topic, channel, DM, or thread.
