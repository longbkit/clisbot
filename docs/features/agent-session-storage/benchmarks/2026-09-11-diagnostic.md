# Storage diagnostic checkpoint — 2026-09-11

This is a completed diagnostic run, **not final acceptance or production UI performance evidence**. All datasets finished, and every canonical fixture row was compared for exact equality. The source tree changed during execution; the worker retained the modules loaded at startup. In particular, these measurements use the earlier projection checkpoint v1 and metadata aggregation, before the subsequent source-range/checkpoint-v2 and metadata concurrency fixes. A final frozen-source run is still required.

The complete, unedited [JSON artifact](2026-09-11-diagnostic.json) includes phase measurements, exact source fingerprints, machine/mount data, budgets, timestamps and workload parameters. The [harness README](../../../../packages/server/scripts/session-storage-benchmark/README.md) documents reproduction and measurement boundaries. Runtime smoke and this full run exited 0. Dedicated benchmark TypeScript checking remains a separate gate.

## Environment and comparability

Run: `2026-09-11T22:05:08.033Z`–`2026-09-11T22:24:35.498Z`, 19m27s. Node 22.23.2, TSX executing production store modules, Linux x64 6.8.0-101-generic, AMD EPYC, four logical cores, 7.76GiB host RAM and 7GiB cgroup limit. Container overlayfs; physical storage medium is unknown. No network or provider process. Cold means a new store owner with **warm OS page cache**, not a dropped kernel cache. The exact mount options are in JSON.

Baseline source is detached HEAD `3e4df80f43ad78218486ac1b3414f98fc71c6b17`, using the same installed dependencies/workspace build artifacts. This is a same-machine module-source comparison, not an independently packaged historical daemon or official upstream client. Upstream reference was `fa93c4290eaa87ae58452ab6e2012f85ae6e0c6b`.

Tracked source diff SHA256 changed from `8882fb1fc8c7fed3d084914790b8d589ddd9ffe9a2c33f790c161929f3756daa` to `b445a1e669b96f61f8c074696a24964ffe82f1ce022023d52a7484d374815fd0`; untracked-content hashes and complete status are in JSON. Around 22:22 UTC, an accidental type-aware lint invocation competed with the 10-writer phase for approximately 20 seconds before its verified task-owned processes were terminated. Available RAM remained above 2GiB. **All samples are retained**, including affected samples; the writer phase must be rerun without competing gates for acceptance.

## Results

Metadata loading/migration has one observation per dataset; these numbers are elapsed API/phase times, not statistically meaningful p95s. Warm aggregation and timeline tail/older pages each have 20 latency samples.

| Metadata operation                         | 1,000 sessions | 10,000 sessions |
| ------------------------------------------ | -------------: | --------------: |
| Baseline legacy load, phase elapsed        |          154ms |         2,285ms |
| Current legacy load, phase elapsed         |        1,135ms |        13,224ms |
| Durable record migration, phase elapsed    |       17,818ms |       174,018ms |
| Current session-layout load, phase elapsed |        1,156ms |        13,717ms |
| Warm workspace authorship aggregation, p95 |          114ms |           984ms |

The dataset has 50/500 workspaces, two participant snapshots per session, channel references, and archived sessions. The baseline strips new authorship fields. The current loader traded sequential reads for lower peak heap: approximately 90MiB versus 148MiB for the baseline at 10,000 records. Source review identified excessive serial I/O and repeated participant-map rebuilding. The owner subsequently changed metadata reads to bounded concurrency and aggregation to a linear pass; those changes are **not measured here**.

| Timeline operation                          | 1,000 mixed rows | 100,000 mixed rows |
| ------------------------------------------- | ---------------: | -----------------: |
| Baseline eager projection, p95              |            8.0ms |            972.6ms |
| Current cold-owner indexed tail, p95        |          269.0ms |            193.7ms |
| Current warm-owner tail, p95                |          380.3ms |            173.5ms |
| Current older page, p95                     |           85.6ms |             69.8ms |
| Indexed tail returned Node bytes per sample |          252,737 |            191,146 |
| Indexed tail Node reads per sample          |            295.1 |              213.1 |
| Canonical + projection rebuild, elapsed     |            2.44s |            148.25s |

The non-monotonic 1,000/100,000 timing illustrates filesystem/process variance; no samples were dropped. Each page requests 40 projected entries. The large dataset mixes running/completed tools, reasoning and assistant chunks, logical user-message IDs/senders, and attachment references. Source fixture bytes and projected/canonical assertions are in the harness. Baseline eager projection retains/copies the full in-memory rows and does not acknowledge durable writes or include provider history loading. These are architectural components, not equivalent end-to-end paths.

Seeding 100,000 canonical rows in batches of up to 256 took 259.31s: 385.65 records/s, 106,156 logical bytes/s, batch acknowledgement p95 1,088.68ms. The canonical fixture contains 27,526,783 logical bytes. The Node instrumentation observed 37,674 fsyncs; Linux `/proc/self/io` reported 156,561,408 physical write bytes. Full rebuild read 123,272,920 process logical bytes and wrote 73,453,568 physical bytes; event-loop lag p95 was 11.90ms and maximum 475.53ms.

Ten concurrent writers each awaited 1,000 single-row durable calls: all 10,000 rows completed and verified in 339.66s, 29.44 records/s, 7,847 logical bytes/s. Durable acknowledgement p50/p95/max was 301.75/586.73/2,109.77ms. There were 193,371 fsync calls and 590,766,080 Linux physical write bytes for 2,665,180 logical row bytes. Event-loop lag p95/max was 12.66/295.96ms; peak heap/RSS 71.7/245.4MiB. Throughput includes final canonical validation; acknowledgement samples measure each awaited append. This poor single-row write amplification is retained as a finding, not hidden by bulk throughput. The brief competing lint process further limits interpretation of this phase.

Six cycles visited 160 distinct one-row sessions using a 128-owner FileStore budget. Every cycle retained exactly 128 owners. Post-GC heap was 54,327,880 / 54,280,984 / 54,322,096 / 54,293,072 / 54,339,272 / 54,289,648 bytes; RSS stayed approximately 245.3–245.4MiB. The predefined plateau criterion passed. This demonstrates only this FileStore ownership workload: no claim about global daemon/client/provider, attachment/fork, subagent, subscription or rendered view retention follows from it.

## Instrumentation limits and remaining acceptance work

Node read instrumentation counts `readFile` and explicit `FileHandle.read`, not internal `createReadStream` reads; `/proc/self/io` supplies process-wide logical/physical counters. Filesystem page-cache hits naturally have zero physical read bytes. Instrumentation itself adds small `/proc` reads and timing overhead. Event-loop histograms may have no samples during an entirely synchronous baseline phase; zero/NaN means unobserved, not zero blocking. RSS peaks can retain allocator pages from earlier baseline phases; inspect start/end/post-GC values in JSON before attributing a peak to one store operation.

Fixed store limits during the run: 16MiB pending journal bytes, 1MiB batch, four concurrent journal I/O operations, 8MiB segment/read-page limits, 256-row index pages, 128 FileStore owners, 1,024 queued FileStore calls, and projection budgets of 16MiB per operation/32MiB global. The ten writers had one outstanding call each, so this workload does not test overload rejection. Separate queue/backpressure regressions are required; these budgets do not account for every upstream daemon/client queue.

Still required: frozen-source benchmark with clean exclusive execution; current source-range and metadata-fix rerun; full daemon/provider and production-browser timing; Android/desktop retention evidence; overload/error/crash and power-loss distinction; actual upstream merge rehearsal plus independently pinned compatibility matrix; actual rollback CLI followed by the old daemon record reader. No AC is marked complete by this checkpoint alone.
