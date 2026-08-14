# Runtime and persistence routing

Read this reference for session, runner, queue, loop, monitor, detached process,
HTTP listener, credential, or persisted-store work.

## Runtime owner chain

| Responsibility | Owner |
| --- | --- |
| Public agent facade and target dispatch | `src/agents/runtime` |
| Session identity and active mapping | `src/agents/session` |
| Durable and in-memory queue behavior | `src/agents/queue` |
| Scheduled loop definitions and reconciliation | `src/agents/loops` |
| Backend-neutral runner bridge | `src/agents/runtime/runner-service.ts` |
| Runner contract and normalized events | `src/runners/contract` |
| Backend mechanics and quirks | `src/runners/<backend>` |
| Detached runtime, monitor, supervisor, health | `src/control/runtime` |
| Runner diagnostics and debug commands | `src/control/runner` |

`SessionService` owns conversation continuity and live run lifecycle.
`RunnerService` dispatches backend operations. A `RunnerBackend` owns launch,
submit, capture, resume, interrupt, and backend-specific recovery mechanics.

## Process boundary

Assume these may be separate OS processes:

- foreground or detached clisbot runtime;
- monitor and supervisor;
- HTTP listener;
- one-shot operator CLI;
- runner subprocess or tmux-hosted CLI.

In-memory caches and locks are process-local. When multiple processes can read
or mutate one value, require an explicit durable store, IPC path, owner-process
command, or single-writer invariant.

## Persistence classification

Classify data before choosing storage:

- **config**: desired runtime control plane;
- **secret**: credentials or auth material with owner-only permissions;
- **canonical state**: behavior depends on survival across restarts;
- **projection**: recoverable summary derived from another owner;
- **diagnostic**: status or troubleshooting evidence;
- **transient state**: live process truth that must not become canonical merely
  because persistence is convenient.

Read `docs/architecture/persistence-stores.md` before adding or splitting a
store. Prefer an existing owner store when ownership, lifecycle, retention, and
coordination match.

For multi-process JSON mutation, use `src/infra/json-storage.ts` and
`withJsonFileMutation`. The owner still supplies schema validation, migration,
retention, pruning, and domain effects. Preserve `0o600` for secrets.

## Required design questions

1. What is the canonical identity and owner?
2. Which process creates, reads, mutates, and deletes it?
3. Is the value desired config, live truth, projection, diagnostic, or secret?
4. Which existing store is insufficient?
5. What prevents lost updates, stale reads, partial writes, and duplicate work?
6. What is the retry, restart, retention, migration, and cleanup behavior?
7. Which status/log surface reports degradation truthfully?
8. Which independent-store or cross-process test proves the design?

## Runner capability rule

Consumers branch on declared runner capabilities, not CLI-family strings.
Runner-specific parsing, permission handling, session-id mechanics, and recovery
stay behind the backend contract. Unsupported behavior degrades truthfully; it
must not silently pretend to work.
