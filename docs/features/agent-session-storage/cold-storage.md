# Cold agent records and list cost

A daemon keeps every agent record it has ever stored. Without retention, a busy Host gains about
100 records a workday, and two costs grow with that total rather than with the agents in use:

- **Startup.** The authorship probe reads and parses every session's `events.index.json` before the
  daemon listens.
- **Lists.** `fetch_agents` re-projected every stored record into an `AgentSnapshotPayload` on
  every call, and `bot.list` re-read and re-parsed every Bot file on every call. Both run on the
  daemon's one event loop, so twenty connected clients multiply them.

Cold storage removes both costs without deleting, moving or hiding a session.

## Behavior

A record is **cold** when cold storage is on, the record is not internal, and its last activity
(`lastActivityAt`, else `updatedAt`) is older than `coldAfterDays`. Everything else is **warm**.

| Surface                       | Warm record                         | Cold record                                                                      |
| ----------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| Startup authorship probe      | Before the daemon listens, as today | Deferred: first history open of that agent, or the background drain after listen |
| `fetch_agents` / history list | Listed                              | Listed, identical payload                                                        |
| Stored payload projection     | Once per record version             | Once per record version                                                          |
| Prompt, load, timeline read   | Unchanged                           | Unchanged; the first log open runs the deferred probe before it reads            |

- **Deferred probe.** `recoverStoredSessionAuthorship` skips cold records and returns
  `DeferredAuthorshipProbes`. The timeline store calls it before every log open, inside that agent's
  operation order, so the probe never races a history write. A replay found there is queued on the
  authorship recovery queue, never awaited inside the open. After the daemon listens, a drain probes
  what is left, one record per event-loop turn, through the same per-agent order. A probe runs at
  most once per agent per daemon run.
- **Projection cache.** `AgentDirectory` caches each stored payload in a `WeakMap` keyed by the
  record object, shared by every client session. Storage replaces the record object on every write,
  so a changed record misses and an unchanged one hits. The cache key also carries the registered
  provider ids, because a stored payload depends on provider availability. Callers receive a
  shallow copy.
- **Bot list cache.** `BotStore.list` reuses its last read until a write through the store or a
  change of the `bots/` directory: its mtime or the file names in it (a file added, removed or
  renamed in). The names matter on NTFS, which can update a directory's mtime late; Windows CI
  missed an added file on the mtime alone. Writes through the daemon go through the store, and
  `writeJsonFileAtomic` renames into the directory.

Why a cold record may skip the startup probe: the probe repairs a record whose authorship lags its
log after a crash between the two writes. A record goes cold only after `coldAfterDays` without a
write, so any daemon start inside that window already probed it. The deferred probe covers a daemon
that stayed down longer than the window.

## Configuration

`features.agentColdStorage` in `config.json`; read at startup.

| Field           | Default | Environment override              | Meaning                                                    |
| --------------- | ------- | --------------------------------- | ---------------------------------------------------------- |
| `enabled`       | `true`  | `CLISBOT_AGENT_COLD_STORAGE=0\|1` | Off restores upstream startup, list and `bot.list` exactly |
| `coldAfterDays` | `3`     | `CLISBOT_AGENT_COLD_AFTER_DAYS=N` | `0` makes no record cold; the list caches stay on          |

`COMPAT(clisbot-agent-cold-storage-default)`: upstream Clisbot has no cold storage; the fusion
default is on.

## Measurements

1,000 production-shaped records (20 workspaces, 200–600 indexed rows each, 96% older than three
days) and 30 Bot files, on one Linux host. The in-process daemon runs used
`createClisbotDaemon` on a copied home, the same home for both states.

| Measure                                        | Off      | On        |
| ---------------------------------------------- | -------- | --------- |
| Daemon start to listening (two runs)           | 8.5–12 s | 3.6–3.7 s |
| Startup authorship probe                       | 1,329 ms | 69 ms     |
| `AgentDirectory.list`, 1,000 records, per call | 13.0 ms  | 1.0 ms    |
| `fetch_agents` round trip, page of 200, p50    | 31–34 ms | 22 ms     |
| `BotStore.list`, 30 files, per call            | 12.7 ms  | 0.5 ms    |

The `fetch_agents` page is byte-identical in both states apart from `requestId`.

## Limitations

- `AgentStorage` still parses every `session.json` at startup (about 0.85 s per 1,000 records on
  the host above) and keeps every record in memory. A record is about 1 KB; a persisted index that
  lets cold records load on first use is the follow-up.
- `fetch_agents` still filters and sorts every listed payload per call; with projections cached
  this is under 1 ms per 1,000 records.
- An edit to a Bot file made in place outside the daemon is not seen until the next write through
  the store or a directory change.
- Retention and compaction of old logs stay out of scope; see the Host-side proposals in
  [the storage volume decision](../../decisions/2026-10-25-offline-storage-volume.md#5-host-side-sandbox-retention--the-other-half).
