# Session storage benchmark

Run from the repository root after building the protocol/client workspace declarations. This harness imports the production storage modules, not copies or reduced implementations. It preserves its generated fixture directory and writes a JSON report after every phase.

```sh
node --expose-gc --import tsx packages/server/scripts/session-storage-benchmark/run.ts \
  --data /tmp/session-storage-benchmark-full \
  --output /tmp/session-storage-benchmark-full.json \
  --baseline-root /tmp/session-storage-baseline-3e4df80
```

The data directory must be empty. No developer Paseo home is read or modified. `--smoke` reduces the datasets and must never be presented as the full benchmark. `--samples`, `--writer-rows`, and `--cycles` override their default values of 20, 1,000, and 6. Keep these values identical for comparisons.

Iteration acceptance uses fixed practical workloads: **1,000 canonical rows is the required gate**, **10,000 rows is the required stress gate**, and **100,000 rows is an optional ceiling diagnostic** with a hard timeout of about five minutes. A timeout at 100,000 rows records the stress limit and does not fail the iteration. Each 20-row block contains a user with a sender snapshot and attachment reference, an overlapping running/completed tool, reasoning, and assistant chunks with shared message IDs. A real 1 KiB attachment fixture is present. Upload authorization, ownership linking, copying, and download latency are separate workloads.

The upstream parity phase measures one full in-memory load over the same fixture. It is the baseline for the required gates; the 100,000-row eager-projection phase is diagnostic only and must not replace the parity measurement.

The default full run executes only the required 1,000- and 10,000-row datasets. Add `--ceiling` to opt into the optional 100,000-row diagnostic; callers should enforce the approximately five-minute timeout around that run.

`--writers-only` runs just the writer phases. The writer test runs ten sessions concurrently with one outstanding durable append per session; the pipelined writer test fires every row for a session without waiting, the way the daemon enqueues timeline rows, so rows queued behind an in-flight append share one fsync. The append promise includes canonical and projected-index durability; assertions check every acknowledged sequence and the final row count. It does not saturate the daemon's ingress/staged/steer/provider queues and does not establish system-wide overload behavior. The owner retention test cycles over 160 sessions, exceeding the 128-journal owner cache, with fixed page and queue limits. Its heap criterion is reported explicitly (last post-GC heap no more than first plus max(8 MiB, 20%)); passing it does not prove app, provider, upload, or subagent retention.

Cold reads create a new store owner over valid indexes. The filesystem cache is warm from seeding; the harness never runs `drop_caches` or treats these results as cold-device reads. Initial fixture construction is not a durability measurement. Migration uses `AgentStorage`'s real raw-byte move and verifies a representative record. Index rebuild deletes only generated benchmark indexes and verifies the original epoch and latest sequence.

The report includes raw acknowledgement distributions, next-page samples, throughput, process heap/RSS, event-loop delay, Node read counts, fsync count/mean/max, and Linux `/proc/self/io` deltas. Logical payload bytes, cached syscall bytes (`rchar`/`wchar`), and attributed device bytes (`read_bytes`/`write_bytes`) have different meanings. Node byte instrumentation does not count stream internals; OS counters include them. Memory includes the harness and its bounded sample arrays; GC is outside timed phases. OS/fsync behavior is not a power-loss guarantee.

A detached baseline checkout can be created without changing the working branch/index:

```sh
git worktree add --detach /tmp/session-storage-baseline-3e4df80 3e4df80f43ad78218486ac1b3414f98fc71c6b17
ln -s "$PWD/node_modules" /tmp/session-storage-baseline-3e4df80/node_modules
```

The baseline executes HEAD's legacy metadata loader and eager in-memory projection over the same fixture shapes on this machine. Installed dependencies/workspace package artifacts are shared, so this is a module-level source comparison, not an independently packaged old-daemon build. HEAD has no matching durable journal API; its projection excludes provider history parsing/startup, disk acknowledgement, and restoration. Metadata results compare record loading separately from the new authorship aggregation. No provider launch time is invented.

These Node measurements do not measure production browser click-to-readable latency, rendered rows/frame time, desktop, native mobile, relay, provider subprocess memory, or complete directory RPC timing. Those require separate harnesses and remain explicit report exclusions.

Before a full long-document rerun, run the modest allocation probe in an empty generated directory:

```sh
node --expose-gc --import tsx packages/server/scripts/session-storage-benchmark/derived-allocation.ts /tmp/session-derived-allocation-1000
```

It commits 1,000 canonical rows in batches of 20: a continuous Unicode answer, then alternating user rows and one old tool whose metadata and disjoint source ranges grow. It verifies every canonical row and reads negotiated descriptors plus bounded document/range pages through a fresh production FileStore. The report separates immutable document nodes, other derived indexes, and canonical/private files; counts files and directories; and records logical bytes and `stat.blocks * 512` allocated bytes. Public Node fs open/write/fsync counters and Linux phase I/O are distinct from physical device behavior. The 100k disk estimate is arithmetic extrapolation, not a completion or performance claim. Its optional second argument accepts 400–1,000 rows, divisible by four; reduced runs must retain their actual count in evidence.
