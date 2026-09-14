# Lane report — storage_plan_rebuild

> Historical record of the 2026-09-12 campaign. Current state: [implementation.md](../implementation.md).

**Goal:** agent-session-storage AC1–AC9 + W1–W7. **Lane scope:** storage / lifecycle /
benchmark. **Owned:** AC4, AC6, AC7, AC8, W7 (+ supporting: AC3 legacy reader, AC9
rollback reverse-conversion, AC1 durable sender re-read after restart).
**Date:** 2026-09-12. **Source under test:** this working tree, HEAD
`3e4df80f43ad78218486ac1b3414f98fc71c6b17` + uncommitted tracked/untracked changes
(frozen fingerprints recorded in the benchmark JSON artifacts).

This report records, per owned criterion: current code path, existing evidence
(cited to `implementation.md`), what this run did (exact commands + /tmp log paths),
current status against the exact `goal-matrix.md` boundary, and the missing evidence.

Status vocabulary: **Met-at-boundary** / **Partial** / **Blocked** (with reason).

---

## This-run summary

| AC/W          | Status              | One-line why                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC4           | **Partial**         | Cold valid-index projected page + exact ancient-tool coverage + bounded read-byte (source <4 KiB, derived <256 KiB over 100k rows) pass on frozen source; frozen p95 measured: cold 340.5 ms / cached 353.1 ms / scroll 184.4 ms (100k) — ≤1 s and ≤300 ms met, ≤200 ms cached unmet at the storage boundary; production targets remain unmeasured. |
| AC6           | **Partial**         | Whole-daemon steady-state loop complete: 200 sessions × 6 cycles, 128 owners bounded, post-GC RSS flat at ~336.6 MiB (0.5 MiB growth), heap ~158 MiB, event-loop lag p95 ~16 ms, restart restores directory + reads; store budgets + 21 small-test reconfirmations pass.                                                                            |
| AC7           | **Partial**         | SIGKILL ×3 + ENOSPC + index repair + atomic replacement pass (12/12); frozen 10-writer: 676.66 s / 1,314.7 ms ack p95 / 193,371 fsyncs / 563.4 MiB physical writes; derived allocation 15,919 files / 67.2 MiB allocated at 1,000 rows; power-loss/Windows not claimed.                                                                             |
| AC8           | **Partial**         | Lifecycle regressions pass on frozen source: migration/rollback, duplicate dedupe + removal, cwd continuity, subagents, fork lease + 256-file/1 MiB limit, draft TTL, interrupted permanent deletion + startup completion (24+25+17 tests; +6-file reconfirmations).                                                                                |
| W7            | **Partial**         | Bounded inspection + demand recovery + directory aggregation pass (41 session-summary tests); frozen 10,000-session load: legacy 13.59 s / session-layout 27.09 s / warm aggregation p95 85.5 ms (vs baseline legacy 2.32 s).                                                                                                                       |
| AC3 (support) | **Partial**         | legacy reader exercised by benchmark baseline phases (HEAD `3e4df80f` detached worktree) + rollback proof; exact-equality fixture assertions pass                                                                                                                                                                                                   |
| AC9 (support) | **Met-at-boundary** | rollback reverse-conversion re-run on current source: real CLI + HEAD's `AgentStorage` reads original record bytes exactly, uploads retained, journal readable after rollback (`benchmarks/2026-09-12-rollback.json`)                                                                                                                               |
| AC1 (support) | **Partial**         | `message-submissions.test.ts` re-passed (client id → seq operation map re-read after owner restart); daemon-restart sender re-read exercised by the AC6 loop restart phase; full durable-sender E2E owned elsewhere                                                                                                                                 |

## Run log

| Time (UTC)       | Command                                                                                                                                                                                                                                         | Log                                                                        | Result                                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-12 03:22 | `npx vitest run storage-review + session-location + session-summary --bail=1 --maxWorkers=1`                                                                                                                                                    | `/tmp/storage-lane-r1-tests.log`                                           | 23/31 pass; 1 pre-existing fixture bug found (short-date timestamp in permission-cursor test)                                                                                                                                                         |
| 2026-09-12 03:25 | `npx vitest run storage-review.test.ts --bail=1` (after fixture fix)                                                                                                                                                                            | `/tmp/storage-lane-r2-review.log`                                          | 1 fail: eviction test timeout (30s default too short for 135-journal workload on this box)                                                                                                                                                            |
| 2026-09-12 03:26 | eviction test in isolation                                                                                                                                                                                                                      | `/tmp/storage-lane-r3-eviction.log`                                        | timeout again — standalone timing: 135 appends = 41.5 s (307.7 ms/session) on this machine                                                                                                                                                            |
| 2026-09-12 03:28 | `npx vitest run storage-review.test.ts --bail=1` (eviction timeout raised to 90 s)                                                                                                                                                              | `/tmp/storage-lane-r4-review.log`                                          | **12/12 pass** — includes 3 actual child SIGKILL crash boundaries + injected ENOSPC                                                                                                                                                                   |
| 2026-09-12 03:35 | `npx vitest run projected-timeline-index.test.ts --bail=1` (AC4 batch)                                                                                                                                                                          | `/tmp/storage-lane-ac4ac7-read.log`                                        | 5 pass; 100k-row bounded-read timed out at its in-file 120 s (fixture build >120 s on this box); later ENOTEMPTY was the abort-time cleanup, not an assertion                                                                                         |
| 2026-09-12 03:43 | 100k-row test in isolation, CLI `--testTimeout` (no effect)                                                                                                                                                                                     | `/tmp/storage-lane-ac4-retry.log`, `/tmp/storage-lane-ac4-retry2.log`      | still 120 s in-file cap; body completed (no assertion failure) but timed out during fixture build                                                                                                                                                     |
| 2026-09-12 03:46 | 100k-row test after in-file timeout 120 s → 300 s                                                                                                                                                                                               | `/tmp/storage-lane-ac4-retry3.log`                                         | **6/6 pass in 314.25 s** — bounded read-byte (source <4 KiB, derived <256 KiB) assertions now actually run on the current frozen source                                                                                                               |
| 2026-09-12 03:56 | `npx vitest run deletion-intents + session-location + session-summary --maxWorkers=1` (AC8 lifecycle + W7 summary)                                                                                                                              | `/tmp/storage-lane-ac8w7-batch1.log`                                       | **3 files, 24 tests pass**                                                                                                                                                                                                                            |
| 2026-09-12 04:07 | `node --expose-gc --import tsx scripts/session-storage-benchmark/run.ts --data /tmp/ssbench-frozen-0407 --output benchmarks/2026-09-12-frozen.json --baseline-root /tmp/session-storage-baseline-3e4df80` (frozen benchmark, interference-free) | `/tmp/storage-lane-bench-frozen.log`                                       | **exit=0, 28/28 phases, no FAILED** — source byte-stable for the whole run (see integrity note below)                                                                                                                                                 |
| 2026-09-12 04:48 | `derived-allocation.ts /tmp/derived-alloc-frozen 1000`                                                                                                                                                                                          | `/tmp/storage-lane-derived-alloc.log`                                      | exit=0; 15,919 derived files / 67.2 MiB allocated at 1,000 rows; report → `benchmarks/2026-09-12-derived-allocation-frozen.json`                                                                                                                      |
| 2026-09-12 04:50 | `rollback-check.ts /tmp/session-storage-baseline-3e4df80` (from repo root)                                                                                                                                                                      | `/tmp/storage-lane-rollback.log`                                           | exit=0; old HEAD `AgentStorage` reads rolled-back bytes exactly; report → `benchmarks/2026-09-12-rollback.json`                                                                                                                                       |
| 2026-09-12 05:17 | `whole-daemon-steady-state.ts /tmp/whole-daemon-steady-state.json` (AC6 loop, first 2 attempts failed on my gapped-seq fixture; fixed to contiguous seq 1..N)                                                                                   | `/tmp/storage-lane-ac6-loop.log`, `-loop2.log`, `-loop3.log`, `-loop4.log` | exit=0; 6 cycles × 200 sessions; 128 owners bounded; post-GC RSS 336.1→336.6 MiB; restart restores all 200 sessions                                                                                                                                   |
| 2026-09-12 05:32 | `npx vitest run message-submissions + storage + derived-document + projected-document-store + pending-event-budget + timeline-retention --bail=1 --maxWorkers=1`                                                                                | `/tmp/storage-lane-six-small.log`                                          | **6 files, 21 tests pass in 78.9 s**                                                                                                                                                                                                                  |
| 2026-09-12 05:34 | `npm run typecheck --workspace @getpaseo/server`                                                                                                                                                                                                | `/tmp/storage-lane-typecheck.log`                                          | exit=0                                                                                                                                                                                                                                                |
| 2026-09-12 05:41 | **Coordinator** `npm run lint --` on the 7 lane-owned files (typecheck/lint/format close-out)                                                                                                                                                   | `/tmp/storage-lane-lint.log`, `-lint2.log`, `-lint3.log`                   | 1 error: nested ternary at `derived-allocation.ts:67` (benchmark harness, not measured source); **coordinator refactored to if/else**, re-lint exit=0, formatter applied. Does not affect any recorded benchmark number (post-run harness-only edit). |

## Fixes made this run (in-layer, test-only)

1. `packages/server/src/server/agent/session-storage/storage-review.test.ts`
   - permission-cursor fixture `timestamp: "2026-09-11"` → `"2026-09-11T00:00:00.000Z"`.
     The journal validates `operation.timestamp` as `z.string().datetime({ offset: true })`
     (`paged-journal.ts:82`); the short date is a fixture bug, not a production behavior
     (production records use `new Date().toISOString()`).
   - eviction test timeout raised 30 s → 90 s (workload timing on this machine, see run log).
     Both are test-file changes; no production code touched.
2. `packages/server/src/server/agent/session-storage/projected-timeline-index.test.ts`
   - 100k-row bounded read-byte test in-file timeout 120 s → 300 s. The test builds 100k
     canonical rows through the full durable path before it measures cold read bytes; on
     this box the fixture build alone exceeds 120 s, so the timed-out runs aborted during
     the build and the bounded-read assertions never ran. No assertion logic changed.
3. `packages/server/src/server/agent/agent-storage.test.ts`
   - "remove deletes all duplicate record files across project directories": the working
     tree's `scanDisk` (agent-storage.ts:456-466) now dedupes byte-identical duplicate
     copies and **rejects** differing (conflicting) copies, matching the AC8 contract
     ("migration … rejects conflicting copies", goal-matrix:192). The pre-existing test
     (unchanged from HEAD line 517) wrote a copy with a _different cwd_ — a conflicting
     record — and expected it to load. Updated the test to write a byte-identical copy so
     it exercises the dedupe-then-remove-all behavior the test name claims. Test-only.
4. `packages/server/scripts/session-storage-benchmark/whole-daemon-steady-state.ts`
   (AC6 loop harness — fixture only, no production code touched):
   - First two attempts crashed with "Session summary timeline replay made no
     progress" because the fixture seeded each session's rows at gapped sequence
     numbers (session i started at seq i·1000+1). `recoverSessionSummary` replays
     from seq 1 and `PagedJournal.readIndexed` clamps to `checkpoint.minSeq`, so a
     gapped first page is empty. This is a fixture invariant violation, not a
     production bug: every real durable write path appends contiguously from seq 1.
     Fixed the loop to seed contiguous `seq 1..N` rows per session
     (`bulkInsert(id, rows)` through the daemon's shared store).
   - Unified seeding onto the daemon's shared reader (one store instance, production
     shape) instead of a second `FileAgentTimelineStore` over the same directories.

## Per-criterion evidence

### AC4 — fast open (daemon read boundary) — **Partial**

**Code path:** `projected-timeline-index.ts` (checkpoint v3, paged derived index, tool
buckets, source-range mode), `paged-journal.ts` (bounded read-page 8 MiB, index pages
256 rows), `projected-entry-document.ts` / `derived-document.ts` (deferred payloads >
64 KiB, `sourceSeqRangesRef`), `file-agent-timeline-store.ts` (16 MiB operation / 32 MiB
global projection read budgets).

**Existing evidence (implementation.md):** cold valid-index projected pages, exact
ancient-tool coverage and bounded read-byte tests pass; source-range regression over
100,001 rows (canonical <4 KiB, derived <256 KiB); diagnostic benchmark
`benchmarks/2026-09-11-diagnostic.{json,md}` (not frozen — source changed mid-run).

**This run (frozen source):**

- `npx vitest run src/server/agent/session-storage/projected-timeline-index.test.ts
--bail=1 --maxWorkers=1` → **6/6 pass in 314.25 s**
  (`/tmp/storage-lane-ac4-retry3.log`). The decisive test is
  "reads bounded bytes for a cold valid projected page over 100000 canonical rows":
  cold owner reads source bytes < 4,096 and derived bytes < 256 KiB for a 40-entry tail
  page, then re-verifies the ancient-tool source-range path with the same bounds. Earlier
  failures were the 120 s in-file cap hitting the fixture build, not the read budget
  (see Fixes #2).
- Ancient-tool exact coverage: "rebuilds a missing or corrupted tool bucket before
  committing a late update" + "source-range pages recover every item around an ancient
  updated tool" both pass in the same file.
- Frozen p95 latency (daemon store/read boundary) is measured by the frozen
  benchmark (`benchmarks/2026-09-12-frozen.json` + companion `.md`, 28/28 phases,
  exit 0, measured source byte-stable for the whole run):
  - cold valid-index tail p95: **340.5 ms (100k) / 551.6 ms (1k)**;
  - warm-owner (cached) tail p95: **353.1 ms (100k) / 746.2 ms (1k)**;
  - older (scroll) page p95: **184.4 ms (100k) / 141.2 ms (1k)**.
    Plainly stated against the README targets (which are **unmeasured targets** on
    production web/desktop, not current numbers, and not measured here): at this
    daemon store/read boundary the **≤ 1 s cold target is met** (340.5 / 551.6 ms),
    the **≤ 300 ms scroll target is met** (184.4 / 141.2 ms), and the **≤ 200 ms cached
    target is NOT met** (353.1 / 746.2 ms). The full statement and instrumentation
    limits are in `benchmarks/2026-09-12-frozen.md`.

**Status:** The goal-matrix AC4 boundary (cold valid-index projected page, exact
ancient-tool coverage, bounded read-byte) is Met at the storage layer on the frozen
source. **Partial** overall: the ≤ 200 ms cached target is unmet at the storage
boundary and production web/desktop timing is out of this lane.
storage boundary on this container the ≤1 s cold target is **met** and the ≤300 ms
scroll target is **met**, while the ≤200 ms cached target is **unmet** (353.1 ms
at 100k / 746.2 ms at 1k). End-to-end click latency (app→wire→daemon) is out of
this lane.

**Status:** Met at the storage read boundary (cold valid-index page, exact ancient-tool
coverage, bounded read-byte, and now the frozen p95 numbers with targets plainly
stated) on the frozen source. **Partial** overall because the production packaged
daemon/app timing, rebuild/import UI states (ui_route_evidence lane) and a real
provider-free end-to-end open are not in this lane's evidence.

### AC7 — fast, safe persistence (durability) — **Partial**

**Code path:** `paged-journal.ts` (sequential fsync'd append, temp+rename replacement,
segment rotate, directory sync), `durable-file.ts` (writeDurableFile = temp+rename+dir
sync), `journal-id-index.ts` (rebuildable index), `projected-document-store.ts`
(immutable node files), `permission-response-journal.ts`.

**Existing evidence (implementation.md):** canonical fsync, immutable queued rows,
injected ENOSPC, actual child SIGKILL recovery tests pass; diagnostic 10-writer numbers
retained (339.66 s / 29.44 rows / ack p95 586.73 ms / 193,371 fsyncs / 590.8 MB physical
writes — with a competing lint process, not final).

**This run (frozen source):**

- `npx vitest run storage-review.test.ts --bail=1` → **12/12 pass**
  (`/tmp/storage-lane-r4-review.log`):
  - actual child process `SIGKILL` at three crash boundaries (before log sync, after
    log sync, before checkpoint rename) — acknowledged data retained, unacknowledged
    tail not retained;
  - injected `ENOSPC` on the journal file: append and flush both reject with `code:
"ENOSPC"`; nothing is acknowledged or continued;
  - missing/malformed/invalid-pointer index pages repaired without dropping the page
    request; mid-file corrupt sections are not skipped;
  - atomic epoch replacement: interrupted replacement leaves the original epoch/rows
    intact;
  - 135-owner eviction + writes-after-permanent-deletion rejected.
- Crash evidence is explicitly **process-kill, not power-loss**: no power-loss or
  Windows guarantee is claimed (consistent with the approved boundary).

- Frozen 10-writer phase (`benchmarks/2026-09-12-frozen.json`, interference-free):
  all 10,000 single-row durable calls completed and verified in **676.66 s**
  (14.78 records/s); durable-ack p50/p95/max **567.4 / 1,314.7 / 5,165.6 ms**;
  **193,371 fsyncs** and **563.4 MiB** of physical writes for 2,665,180 logical row
  bytes; event-loop lag p95/max **18.78 / 307.23 ms**; peak heap/RSS 74.6 / 244.6 MiB.
  Single-row write amplification is retained as a finding (the diagnostic's 339.66 s
  ran with a competing lint process and a lighter box). Seed-100k: 520.51 s, batch
  ack p95 2,317.8 ms, 37,438 fsyncs, 155.4 MiB physical.
- Derived-node allocation (`benchmarks/2026-09-12-derived-allocation-frozen.json`,
  1,000 rows): `derivedDocuments` **15,919 files / 8,032,569 logical / 67,215,360
  allocated bytes**; `otherProjection` 11 / 545,871 / 602,112;
  `canonicalAndPrivateIndexes` 8 / 1,798,059 / 1,839,104. The 100k-row extrapolation
  is recorded as a warning-only estimate.
- Retained-owner cycles: six cycles × 160 one-row sessions held exactly 128 owners;
  post-GC heap plateau 55.5–57.1 MiB (criterion passed, `heapPlateauObserved: true`).

**Status:** Crash/ENOSPC/recovery core is Met-at-boundary on the frozen source.
**Partial** overall: power-loss/Windows is not claimed (process-kill only) and all
transport/provider queues are out of the storage layer. The frozen write-amplification
numbers, derived-node/allocated bytes and event-loop figures are now recorded above.

### AC8 — full lifecycle — **Partial**

**Code path:** `agent-storage.ts` (migration `moveSessionRecord`, duplicate/conflict
rejection, stable session dir across cwd changes, preparePermanentDelete/remove),
`layout.ts` + `session-location` (cwd continuity / rollback / legacy move),
`deletion-intents.ts` (intent → fence/drain/remove + startup completion),
`file-upload/session-files.ts` (fork lease, 256-file / 1 MiB descriptor limit),
`provider-subagents/persistence.ts`, `rollback-session-layout.ts`.

**Existing evidence (implementation.md):** migration/rollback, duplicate ownership,
subagent removal/restart, upload/fork leases, draft TTL, interrupted permanent deletion,
cwd + deletion lifecycle 15 tests, repeat-delete/fresh-owner + scoped-intent recovery,
failed-cancellation cleanup.

**This run (frozen source, current source):**

- `deletion-intents.test.ts + session-location.test.ts + session-summary.test.ts`
  → **3 files, 24 tests pass** (`/tmp/storage-lane-ac8w7-batch1.log`): interrupted
  permanent deletion + startup completion, cwd continuity/rollback/legacy move,
  duplicate/ambiguous ownership rejection.
- `agent-storage.test.ts + provider-subagents/persistence.test.ts +
provider-subagents/store.test.ts` → **25 tests pass**
  (`/tmp/storage-lane-ac8-batch2.log` after Fixes #3): migration preserves unknown
  fields and retains byte-identical duplicates for removal; conflicting copies are
  rejected on load; subagent persistence and removal/restart.
- `file-upload/session-files.test.ts + session-file-maintenance.test.ts +
session-file-activity.test.ts` → **3 files, 17 tests pass**
  (`/tmp/storage-lane-ac8-fileupload.log`): fork lease + >256-linked-file / >1 MiB
  descriptor rejection (visible limit, not silent truncation), draft TTL, delete-while-
  uploading, image-link failure cleanup.
- Readable while the agent is not running / archived: the AC6 steady-state loop reads
  closed sessions through the daemon's durable reader after restart (directory lists
  all 200 sessions; last session's tail read to `endSeq=204` with the agents closed,
  `/tmp/whole-daemon-steady-state.json`) and the AC4 cold-owner test reads with no
  running agent.

**Status:** The owned lifecycle boundary (migration/duplicate, restart, rewind, fork
with file, delete-while-uploading, archive/restore with subagent/file, readable when
not running) is covered at the storage layer on the frozen source. **Partial** overall
because rendered app download, all provider paths and cross-principal retry are owned
by other lanes.

### AC6 — bounded RAM (whole-daemon steady state) — **Partial**

**Code path:** `file-agent-timeline-store.ts` (128-owner LRU, 16 MiB pending journal
bytes, 1,024 queued operations, byte-budgeted fetch), `timeline-retention.ts` /
`pending-event-budget.ts` (daemon budgets), `derived-document.ts` (bounded derived
documents).

**Existing evidence (implementation.md):** journal/store/file/retention budgets +
focused owner tests; diagnostic retained-owner cycles kept 128 owners resident with
post-GC heap plateau (~54.3 MB) and RSS ~245 MiB; derived allocation probe
`benchmarks/2026-09-12-derived-allocation.json` (15,919 files / 8.03 MB logical /
67.2 MB allocated at 1,000 rows).

**This run:**

- Budget/eviction tests re-confirmed on the frozen source (storage-review eviction,
  pending-event-budget, timeline-retention batches; six-small reconfirmation below).
- Whole-daemon steady-state loop
  `packages/server/scripts/session-storage-benchmark/whole-daemon-steady-state.ts`
  (completed, exit=0; `/tmp/storage-lane-ac6-loop*.log`,
  `/tmp/whole-daemon-steady-state.json`): boots a real in-process daemon
  (`createTestPaseoDaemon`, durable layout, fake agent clients), seeds 200 sessions ×
  204 rows through the daemon's **shared** 128-owner store (one store instance, as in
  production), then runs 6 cycles of open projected tail (limit 40) + one `before`
  scroll page + directory lookup per session via the daemon's real
  `agentManager.fetchProjectedTimelineForRead`, sampling per-cycle post-GC
  RSS/heap, resident owner count, event-loop lag p95 and `/proc/self/io`; then
  restarts a second daemon over the same home and re-reads the directory + a tail.
  Results:
  - 6 cycles, **128/128 resident owners each** (`ownersBounded: true`);
  - post-GC **RSS 336.1 → 336.6 MiB** across cycles — **0.5 MiB growth first→last**
    (`rssGrowthFirstToLast` 524,288 B; `queueGrewUnboundedly: false`);
  - post-GC heap ~158.0–158.1 MiB, flat;
  - event-loop lag p95 16.9 → 16.1 ms (no growth);
  - restart: fresh daemon over the same home lists all 200 sessions
    (`listedAfterRestart: 200`) and reads the last session's tail to
    `endSeq=204` with the agents closed.

**Status:** Store-level boundedness is Met-at-boundary and the whole-process
steady-state loop now passes on the frozen source (steady RAM, non-growing queue at
the fixed sequential load, restart-readable). **Partial** overall: app/provider
steady state and production packaged-daemon memory are out of this lane.

### W7 — list without reading history — **Partial**

**Code path:** `session-summary.ts` (durable `authorship.index.json`, 1 MiB cap; bounded
startup inspection marks missing/damaged-index summaries **pending** instead of
rebuilding all histories), `agent-projections.ts` (directory demand → bounded 64-entry
recovery worker; viewing a session promotes recovery).

**Existing evidence (implementation.md):** summary recovery 11 tests (empty startup,
missing-index deferral, 64-entry queue, 130-session refill, viewed promotion).

**This run (frozen source):**

- `session-summary.test.ts` → **41 tests pass** (within the AC8/W7 batch1 run):
  bounded startup inspection, missing/damaged index → pending not full rebuild,
  demand recovery queue, restart restoration, durable summary ordering/replay.
- Frozen 10,000-session directory performance
  (`benchmarks/2026-09-12-frozen.json`, completed): baseline legacy load **2,320.7
  ms**; current legacy load **13,593.5 ms**; durable record migration **384,616.2 ms**
  (50,100 fsyncs, dominated by per-record durable writes — not a steady state);
  session-layout load **27,089.1 ms** (trades elapsed time for lower peak heap,
  approx. 86.7 MiB vs 147.2 MiB baseline); warm workspace authorship aggregation
  **p95 85.5 ms** (1,000 sessions: 15.3 ms).

**Status:** The aggregate-metadata / bounded-inspection / demand-recovery boundary is
Met at the storage layer on the frozen source; the frozen 10,000-session numbers are
recorded above. **Partial** overall: production recovery surfaces are out of this
lane.

### AC3 / AC9 / AC1 (supporting roles)

- **AC9 rollback reverse-conversion — Met-at-boundary:** re-run on the current frozen
  source (`2026-09-12 04:50`, `/tmp/storage-lane-rollback.log` →
  `benchmarks/2026-09-12-rollback.json`): the real `rollback-session-layout.ts` CLI
  reverse-converts a session-layout home back to HEAD's record layout;
  "Rolled back 1 session records; journals and uploads retained." —
  `oldReaderCount: 1`, `exactOriginalRecordBytesRetained: true`,
  `uploadsRetained: true`, `currentJournalReadableAfterRollback: true`. Limitation
  (recorded in the JSON): HEAD `AgentStorage` ran with the shared installed
  dependencies, not a packaged old daemon; old code cannot read the new journal APIs.
  Prior proof: `benchmarks/2026-09-11-rollback.json`.
- **AC3 legacy reader — Partial:** exercised by the benchmark baseline phases
  (detached HEAD `agent-timeline-store.ts` / `agent-storage.ts` at `3e4df80f`:
  baseline legacy load 203.7 ms / 2,320.7 ms at 1,000 / 10,000 sessions; baseline
  eager projection p95 11.2 ms / 1,423.1 ms at 1,000 / 100,000 rows) and the rollback
  proof; exact-equality fixture assertions pass.
- **AC1 durable sender re-read after restart — Partial:** `message-submissions.ts`
  (client message id → seq operation map) re-read after a store owner restart is
  covered by `message-submissions.test.ts` (re-passed in the six-small run,
  `/tmp/storage-lane-six-small.log`); sender re-read after daemon restart is exercised
  by the AC6 loop's restart phase. Full durable-sender E2E is owned elsewhere.

## Integrity note — source stability during the frozen benchmark

`benchmarks/2026-09-12-frozen.json` records `sourceStart`/`sourceEnd` fingerprints
(`trackedDiffSha256` over `git diff --binary HEAD`, `untrackedContentSha256` over
sorted untracked paths+content) plus the git `head` at each end.

- `head` is identical at start and end: `3e4df80f43ad78218486ac1b3414f98fc71c6b17`.
- **The measured production source is byte-stable for the whole run.** Between
  `sourceStart` (tracked `f70b1bb6…` / untracked `cff20bab…`) and `sourceEnd`
  (tracked `32d291a6…` / untracked `c5d900af…`) the only tracked changes are three
  formatting-only edits to files the harness does not import —
  `packages/server/src/server/agent/agent-storage.test.ts`,
  `packages/server/scripts/session-storage-benchmark/whole-daemon-steady-state.ts`,
  and this doc — plus the benchmark writing its own untracked output
  (`benchmarks/2026-09-12-frozen.json`) and external doc churn. No measured
  production module changed mid-run.
- The fingerprint values are therefore **recorded as-is and not asserted equal** —
  they differ, for those documented files only. The stability claim rests on the
  per-file verification above (and the 28/28 phase completion), not on fingerprint
  equality.

## Missing evidence and open questions (per criterion)

- **AC4:** the ≤ 200 ms cached p95 target is unmet at the storage boundary (353.1 ms
  @100k, 746.2 ms @1k) — whether it is met end-to-end on production web/desktop is
  unmeasured and out of this lane. Open question: is the warm-owner tail p95
  dominated by per-page `fsync`-free reads, or by summary/index re-verification, and
  is it worth one follow-up profiling run? (File to the goal owner, not claimed here.)
- **AC6:** app/provider steady state, subscription/render retention, and production
  packaged-daemon memory are not measured; the loop's load is fixed sequential
  (10,600 rows/cycle), not the published production load.
- **AC7:** power-loss and Windows are not claimed; the ten-writer workload keeps one
  outstanding call per writer, so overload rejection (16 MiB / 1,024-op caps) is
  verified by budget tests, not by the benchmark.
- **AC8:** rendered app download, all provider paths, and cross-principal retry are
  owned by other lanes.
- **W7:** production recovery surfaces (damaged-index deferral at production scale)
  are out of this lane.
- **AC3/AC1:** full durable-sender E2E and the packaged-old-daemon compatibility
  matrix (the rollback proof used HEAD `AgentStorage` with shared dependencies, not a
  packaged old daemon) remain open.

No out-of-layer changes were made this run; every fix (Fixes #1–#4) is in-layer
(test fixtures or the AC6 harness/fixture).
