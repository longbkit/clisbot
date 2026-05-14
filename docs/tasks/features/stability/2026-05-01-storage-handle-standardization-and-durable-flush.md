# Storage Handle Standardization And Durable Flush

## Decision

Use one shared `PersistentDocumentHandle<T>` for JSON-like persisted documents,
plus one runtime-owned `FlushCoordinator` for graceful stop or restart.

Keep config, sessions, pairing, health, and other business semantics in
separate stores. Do not build one giant persistence service.

Keep binary files, logs, sockets, token files, and similar artifacts
specialized. Do not force them through the document handle.

## Why This Exists

Current persistence behavior is inconsistent:

- some stores use temp-write plus rename
- some use only in-process locks
- some do plain overwrite
- some hold a whole document in memory and later overwrite the file
- stop and restart do not share one flush contract

That inconsistency creates real risk:

- partial write
- lost update
- stale config overwrite
- stop or restart truth drifting from what actually reached disk

## Standard

### Terms

Use only these names in this design:

- `PersistentDocumentHandle`
- `FlushCoordinator`
- `store`

### Handle Contract

```ts
type PersistentDocumentHandle<T> = {
  read(): Promise<T>;
  replace(next: T): Promise<void>;
  update(mutator: (current: T) => T | Promise<T>): Promise<T>;
  markDirty?(next: T): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
};
```

Meaning:

- `replace()` is caller-owned full replacement
- `update()` is queued read-modify-write
- `markDirty()` is only for stores using dirty-coalesced mode
- `flush()` settles pending state truthfully
- `close()` stops new writes before shutdown finishes

### Responsibilities

`PersistentDocumentHandle` owns:

- one in-process writer queue per absolute path
- temp-write plus rename
- optional advisory lock
- optional dirty tracking
- `flush()` and `close()`

`FlushCoordinator` owns:

- registration of dirty-capable handles
- bounded graceful-stop and graceful-restart flush
- truthful timeout or failure reporting

Each `store` owns:

- schema
- mutation rules
- prune rules
- conflict rules
- durability grade
- write mode

### Mandatory Rules

- every Grade A or Grade B document-handle write uses temp-write plus rename
- every adopted store writes through one path-scoped queue
- adopted stores do not bypass their store with direct file writes
- `close()` blocks new writes before the final flush window
- `flush()` reports persisted, failed, or timed out truthfully
- `clisbot.json` gets config-specific stale-snapshot protection

### Optional Rules

- advisory lock is optional only for files explicitly treated as
  single-writer-by-architecture
- advisory lock becomes mandatory for files treated as
  multi-process-sensitive
- dirty-coalesced mode is optional and should start only where it buys real
  value
- `fsync` is optional in the first slice and does not replace atomic replace or
  queued writes

### Failure-Mode Rules

- partial write:
  - solve with temp-write plus rename
- lost update inside one process:
  - solve with one path queue plus queued `update()`
- stop timeout:
  - bounded wait is mandatory
  - runtime may still stop, but must report that pending state may not have
    reached disk
- restart race:
  - block new writes before final flush starts
- stale config snapshot:
  - mandatory protection for `clisbot.json`
- advisory lock:
  - coordination tool only; it does not solve stale-snapshot conflicts by
    itself

## File Map

| File | Store | Grade | Default Mode | First Action |
| --- | --- | --- | --- | --- |
| `clisbot.json` | config | A | write-through | Migrate early and add stale-snapshot protection. |
| config backups | config upgrade | C | specialized | Keep specialized append-like backup creation. |
| `sessions.json` | session store | A | write-through | Use as the first `PersistentDocumentHandle` implementation target. |
| `processed-slack-events.json` | processed events store | B | write-through first | Migrate early; do not require coalescing in the first step. |
| `runtime-credentials.json` | runtime credentials store | A | write-through | Migrate early and strengthen secret-bearing writes. |
| `activity.json` | activity store | B | dirty-coalesced later | Migrate with flush coordination phase. |
| `runtime-health.json` | runtime health store | B | dirty-coalesced later | Migrate with flush coordination phase. |
| `clisbot-monitor.json` | runtime monitor store | B | dirty-coalesced later | Migrate with flush coordination phase. |
| `surface-directory.json` | surface directory store | B | dirty-coalesced later | Migrate with explicit single-writer vs lock decision. |
| pairing JSON files | pairing store | A | write-through | Keep specialized first; migrate only if the shared path stays simpler than today. |
| `runner-exits/*.json` | runner exit store | C | specialized | Keep specialized. |
| `clisbot.pid` | runtime control | C | specialized | Keep specialized. |
| token files | credentials | D | specialized | Keep specialized. |
| logs | runtime logging | D | specialized | Keep specialized. |
| attachments | attachment storage | D | specialized | Keep specialized. |
| `clisbot.sock` | runtime IPC | D | specialized | Keep specialized; not document persistence. |
| wrapper script | wrapper install | C | specialized | Keep specialized. |

Special note:

- `runtime-credentials.json` is not long-term operator state
- it is runtime-scoped secret cache that must survive monitor-driven restart or
  backoff while the runtime is still alive
- normal service stop may intentionally delete it after shutdown settles

## Cross-Process Rule

Default assumption: do not assume “probably one process”.

Single-writer-by-architecture is plausible first for:

- `activity.json`
- `runtime-health.json`
- `clisbot-monitor.json`
- `runner-exits/*.json`

Multi-process-sensitive until proven otherwise:

- `clisbot.json`
- `sessions.json`
- `runtime-credentials.json`
- pairing files
- `surface-directory.json`
- `processed-slack-events.json`

Hidden assumption to keep explicit:

- current runtime behavior is safest when one active runtime owns one state
  directory
- if operators run two runtimes against the same state directory, more files
  need advisory locking or stronger conflict control

## Stop And Restart Contract

Graceful path:

1. runtime enters draining
2. `FlushCoordinator` blocks new writes via `close()`
3. registered dirty-capable handles attempt bounded `flush()`
4. runtime records clean flush, failed flush, or timed-out flush
5. runtime stops or restarts without overstating durability

Crash path:

- worker crash with monitor alive:
  - no flush guarantee for in-memory dirty state
- monitor crash or host crash:
  - only already-persisted state is recoverable
- hard cleanup after orphaned worker or zombie monitor:
  - treat as recovery cleanup, not graceful persistence

## Main Current Risks

Highest-risk current paths:

- `src/config/core/config-file.ts`
  - plain overwrite, no atomic replace, no stale-snapshot protection
- `src/channels/message/processed-events-store.ts`
  - whole-document cache plus overwrite, easy lost-update risk
- `src/config/channels/channel-runtime-credentials.ts`
  - secret-bearing file, still plain sync overwrite

Important mixed-discipline signal:

- `src/auth/owner-claim.ts` already locks `clisbot.json`
- other config mutation paths still do not
- config writes should converge on one store discipline

## Rollout

### Phase 1

Build `PersistentDocumentHandle` on top of `SessionStore`.

Done when:

- `SessionStore` uses the shared handle without behavior loss
- tests prove queued write ordering, atomic replace, `close()`, and `flush()`
  truthfulness

### Phase 2

Migrate early high-risk stores:

- `clisbot.json`
- `processed-slack-events.json`
- `runtime-credentials.json`

Done when:

- these stores stop doing ad hoc overwrite logic
- `clisbot.json` no longer relies on plain overwrite
- `runtime-credentials.json` no longer relies on plain overwrite

### Phase 3

Add `FlushCoordinator`, dirty tracking, and projection-store migration:

- `activity.json`
- `runtime-health.json`
- `clisbot-monitor.json`
- `surface-directory.json`

Done when:

- graceful stop or restart attempts bounded flush
- flush timeout or failure is reported truthfully
- these stores stop using private overwrite logic

### Phase 4

Add final config conflict protection for `clisbot.json`.

Done when:

- stale config mutation flows cannot silently overwrite each other

## Explicit Deferrals

Do not migrate these in the first implementation slice:

- pairing files
- `runner-exits/*.json`
- token files
- logs
- socket
- attachments
- wrapper script

## Open Questions

- Should `processed-slack-events.json` stay write-through permanently, or later
  become dirty-coalesced?
- Should `runtime-credentials.json` remain one shared JSON file, or later split
  by bot?
- Should config stale-snapshot protection use revision, mtime check, or
  compare-before-write?
- Do we want to formalize “one active runtime per state directory” as an
  architecture rule?
