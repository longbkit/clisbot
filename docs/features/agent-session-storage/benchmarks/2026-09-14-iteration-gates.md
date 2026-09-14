# Iteration benchmark gates — 2026-09-14

The required gates of the [iteration benchmark contract](../iterations/2026-09-13-durable-timeline-and-approval.md):
1,000 rows (clean gate) and 10,000 rows (stress gate). The 100,000-row ceiling
diagnostic is opt-in and was run separately — see below.

Run `2026-09-14T03:45:38Z`–`2026-09-14T03:54:54Z` (9m16s), 28 phases, **no failed phase**.
Node 22.23.2 (`--expose-gc --import tsx`), Linux x64 6.8.0-101-generic, AMD EPYC, 4
logical CPUs, 7.8 GiB RAM, container mount. Parity baseline is the upstream full-load
path at `3e4df80f43ad78218486ac1b3414f98fc71c6b17`. Unedited artifact:
[2026-09-14-iteration-gates.json](2026-09-14-iteration-gates.json).

Reproduce:

```bash
node --expose-gc --import tsx packages/server/scripts/session-storage-benchmark/run.ts \
  --data /tmp/ssb --output /tmp/ssb.json --baseline-root <worktree-at-baseline-head>
```

## Timeline gates

Totals are for 20 samples unless noted; per-page figures are the derived mean.

| Phase                                                      |              1,000 rows |              10,000 rows |
| ---------------------------------------------------------- | ----------------------: | -----------------------: |
| `baseline.timeline.full-load` (upstream parity, in-memory) |                 34.2 ms |                  35.0 ms |
| `baseline.timeline.eager-projection-stress` (diagnostic)   |                 52.8 ms |                 101.4 ms |
| `current.timeline.seed` (durable append, 256-row batches)  |               1204.6 ms |                7075.8 ms |
| `current.timeline.cold-owner-valid-index-tail` (20 pages)  | 470.6 ms → 23.5 ms/page | 1871.4 ms → 93.6 ms/page |
| `current.timeline.warm-owner-tail-and-before` (40 pages)   |  367.8 ms → 9.2 ms/page | 1425.1 ms → 35.6 ms/page |
| `current.timeline.rebuild-canonical-index` (index deleted) |                 54.3 ms |                 252.9 ms |

Both gates ran clean. What the numbers say:

- **A page does not pay for history length in rows read.** The warm-owner phase reads
  5.76 MB over 40 pages at 1,000 rows and 5.84 MB over 40 pages at 10,000 — the same
  ~146 KB per page. The bounded window, not the history, sets the read.
- **Cold cost is the index, not the log.** A cold owner at 10,000 rows reads 761 KB per
  page against 146 KB warm; the difference is loading `events.index.json` once (646 KB
  at this size). Production loads it once per session owner, not once per page.
- **Rebuilding the whole index from the log costs about the same as one cold page.**
  253 ms at 10,000 rows, with the page still correct afterwards.
- **Upstream parity holds.** The baseline full-load phase measures an in-memory
  projection over rows already resident and excludes disk; it is the floor, not a
  competitor. A cold durable page at the required 1,000-row gate is 23.5 ms.

## Optional 100,000-row ceiling

Run under `PASEO_SESSION_STORAGE_CEILING=1` against
`projected-timeline.test.ts > reads a bounded cold projected page over 100000 canonical rows`.
It **completed in 291.4 s**, inside the contract's ~5 minute cap. Wall clock is dominated by
seeding 100,000 rows durably (391 batched appends, each fsynced); the measured read is the
cold page afterwards:

| Measure                                              |   Value |
| ---------------------------------------------------- | ------: |
| Cold projected tail page (40 requested, 42 returned) | 1540 ms |
| `events.jsonl` bytes read for that page              |  365 KB |
| `events.index.json` bytes read (one-time owner load) | 4.96 MB |
| RSS after the page                                   |  203 MB |

365 KB of log read against a 100,000-row history is the bounded window doing its job. The
index dominates the cold cost and is loaded once per session owner. An earlier attempt with a
320 s cap was killed mid-seed; the number above is from the completed run.

## Writers and retention

- `current.timeline.10-concurrent-writers`: 10 writers × 1,000 rows, 45.2 s,
  0 dropped or early-acknowledged rows, 10,661 fsyncs (mean 9.5 ms, max 266.6 ms).
  Durability, not throughput, dominates this phase.
- `current.timeline.retained-owner-cycle.0..5`: 160 owners visited per cycle,
  128 resident — the cap held every cycle.
- `current.timeline.retention-summary`: heap plateaued (55.67 MB → 55.69 MB across six
  cycles, allowance 11.1 MB), RSS flat at ~247 MB.

## Not measured here

Metadata migration phases dominate wall-clock (5.7 min for 10,000 session records) and
are unrelated to this iteration — they convert `{agentId}.json` records into session
directories. App render, native, relay, browser and provider-process behaviour are
outside the harness, as the [harness README](../../../../packages/server/scripts/session-storage-benchmark/README.md)
states.
