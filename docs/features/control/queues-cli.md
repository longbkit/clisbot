# Queues CLI

`clisbot queues` is the operator-facing control surface for durable one-shot
queued prompts.

It uses the same routed session model as loop creation: operators address a
supported message surface, and clisbot stores the queued prompt under that
session entry.

## Commands

- `clisbot queues list`
- `clisbot queues list --channel telegram --target group:-1001234567890 --topic-id 4335`
- `clisbot queues status`
- `clisbot queues create --channel telegram --target group:-1001234567890 --topic-id 4335 --sender telegram:1276408333 review backlog`
- `clisbot queues clear --channel telegram --target group:-1001234567890 --topic-id 4335`
- `clisbot queues clear --all`

## Contract

- `list` shows pending queued prompts only.
- `status` shows pending and running queued prompts.
- `clear` removes pending prompts only and does not interrupt a running prompt.
- `create` matches the documented `loops create` addressing shape: it requires
  explicit `--channel/--target` routed addressing.
- `create` requires `--sender <principal>`.
- `create` is capped by `control.queue.maxPendingItemsPerSession`, which
  defaults to `20` when omitted from config.
- `create` posts a visible surface acknowledgement after persistence, using
  the same queue-position wording as `/queue` plus the full submitted prompt:
  `Queued: 2 ahead. Prompt: ...`.
- `--current` is intentionally unsupported because a short-lived operator CLI
  does not have a reliable ambient current surface.

## Persistence

Queue state is stored in the existing session store:

```text
session.storePath
  -> Record<sessionKey, StoredSessionEntry>
  -> StoredSessionEntry.queues?: StoredQueueItem[]
```

The stored `queues` array is the canonical queue inventory for `/queue list`,
`/queue clear`, and `clisbot queues`. The live runtime hydrates pending stored
items into its internal ordered drain so `positionAhead`, active-run idle
guards, lazy prompt rebuild, start notifications, and cleared-pending
settlement all follow one queue contract instead of a separate persisted table
plus a separate legacy runtime queue.

The CLI persists queue items but does not execute prompt delivery itself. A
successful `create` posts a queue-created acknowledgement to the stored surface
so CLI-created work is visible before it starts. A running runtime reconciles
persisted pending queue items into the same runtime drain used by `/queue`.
Runtime-reconciled items still post queue-start notifications and terminal
settlement through the stored surface binding. If the runtime is stopped,
queued prompts activate on the next `clisbot start`.

Persisted `running` queue items are preserved while the session still has a
blocking active run. Once reconciliation sees the session idle, clisbot removes
the stale running queue item instead of letting it block newer queued prompts.

The queue CLI intentionally has one public routed addressing shape: the same
explicit `--channel/--target` route addressing used by loops.

## Addressing

Telegram examples should use route-style targets instead of bare ids:

- `--channel telegram --target group:-1001234567890 --topic-id 4335`
- `--channel telegram --target topic:-1001234567890:4335`

Slack examples:

- `--channel slack --target group:C1234567890`
- `--channel slack --target group:C1234567890 --thread-id 1712345678.123456`
- `--channel slack --target group:C1234567890`
- `--channel slack --target group:C1234567890 --thread-id 1712345678.123456`

## Tests

- `test/queues-cli.test.ts`
- `test/session-state.test.ts`
- `test/job-queue.test.ts`
- `test/interaction-processing/interaction-processing.test.ts`
