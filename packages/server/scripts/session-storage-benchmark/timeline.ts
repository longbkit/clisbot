import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { SessionEventLog } from "../../src/server/agent/session-storage/session-event-log.js";
import { FileAgentTimelineStore } from "../../src/server/agent/session-storage/file-agent-timeline-store.js";
import { mixedRow } from "./fixtures.js";
import { parallelIndices } from "./directory.js";
import { percentile } from "./metrics.js";
import type { BenchmarkContext } from "./run.js";

const PIPELINE_BURST_ROWS = 100;

async function verifyCanonical(store: FileAgentTimelineStore, id: string, count: number) {
  const epoch = await store.getEpoch(id);
  let verified = 0;
  while (verified < count) {
    const page = await store.fetchCommitted(id, {
      direction: "after",
      cursor: { epoch, seq: verified },
      limit: 256,
    });
    assert(page.rows.length > 0);
    for (const row of page.rows) {
      verified += 1;
      assert.deepEqual(row, mixedRow(verified));
    }
  }
  assert.equal(verified, count);
}

async function baselineTimeline(context: BenchmarkContext, count: number) {
  const { baselineRoot, phase } = context;
  if (!baselineRoot) return;
  const storeModule = (await import(
    pathToFileURL(
      path.join(baselineRoot, "packages/server/src/server/agent/agent-timeline-store.ts"),
    ).href
  )) as typeof import("../../src/server/agent/agent-timeline-store.js");
  const projectionModule = (await import(
    pathToFileURL(
      path.join(baselineRoot, "packages/server/src/server/agent/timeline-projection.ts"),
    ).href
  )) as typeof import("../../src/server/agent/timeline-projection.js");
  await phase(`baseline.timeline.full-load.${count}`, async (sample) => {
    const rows = Array.from({ length: count }, (_, index) => mixedRow(index + 1));
    const store = new storeModule.InMemoryAgentTimelineStore();
    store.initialize("history", { rows });
    const start = performance.now();
    const loaded = store.getRows("history");
    assert.equal(loaded.length, count);
    sample.acknowledge(
      performance.now() - start,
      Buffer.byteLength(JSON.stringify(loaded)),
      loaded.length,
    );
    return {
      canonicalRowsRetained: rows.length,
      durableAcknowledgement: false,
      projection: "not measured in parity phase",
      excludesProviderHistoryLoad: true,
    };
  });
  await phase(`baseline.timeline.eager-projection-stress.${count}`, async (sample) => {
    const rows = Array.from({ length: count }, (_, index) => mixedRow(index + 1));
    const store = new storeModule.InMemoryAgentTimelineStore();
    store.initialize("history", { rows });
    const start = performance.now();
    const page = projectionModule.selectProjectedTimelinePage({
      rows: store.getRows("history"),
      direction: "tail",
      limit: 40,
    });
    assert(page.entries.length > 0);
    sample.acknowledge(performance.now() - start, 0);
    return { canonicalRowsRetained: rows.length, diagnosticOnly: true };
  });
}
export async function timelineBenchmarks(context: BenchmarkContext, count: number) {
  const { root, samples, phase } = context;
  await baselineTimeline(context, count);
  const directory = path.join(root, `timeline-${count}`);
  await fs.mkdir(path.join(directory, "uploads"), { recursive: true });
  await fs.writeFile(path.join(directory, "uploads", "fixture.txt"), "x".repeat(1024));
  const resolveDirectory = async () => directory;
  const store = new FileAgentTimelineStore(resolveDirectory);
  await phase(`current.timeline.seed.${count}`, async (sample) => {
    for (let startSeq = 1; startSeq <= count; startSeq += 256) {
      const rows = Array.from({ length: Math.min(256, count - startSeq + 1) }, (_, index) =>
        mixedRow(startSeq + index),
      );
      const start = performance.now();
      await store.bulkInsert("history", rows);
      sample.acknowledge(
        performance.now() - start,
        Buffer.byteLength(JSON.stringify(rows)),
        rows.length,
      );
    }
    assert.equal(await store.getLatestCommittedSeq("history"), count);
    return { batchRows: 256, includesDurableCanonicalAndDerivedAcknowledgement: true };
  });
  const epoch = await store.getEpoch("history");
  // Validate every durable row with bounded pages outside latency samples.
  await verifyCanonical(new FileAgentTimelineStore(resolveDirectory), "history", count);
  await phase(`current.timeline.cold-owner-valid-index-tail.${count}`, async (sample) => {
    for (let index = 0; index < samples; index++) {
      // A new owner is only cold once the process-wide index cache is dropped too.
      await store.flush();
      SessionEventLog.forgetAll();
      const cold = new FileAgentTimelineStore(resolveDirectory);
      const start = performance.now();
      const page = await cold.fetchProjectedCommitted("history", { limit: 40 });
      assert.equal(page.epoch, epoch);
      assert(page.entries.length > 0);
      assert.equal(page.endSeq, count);
      sample.acknowledge(performance.now() - start, Buffer.byteLength(JSON.stringify(page)));
    }
    return { pageSize: 40, cold: "new owner; warm OS cache" };
  });
  await phase(`current.timeline.warm-owner-tail-and-before.${count}`, async (sample) => {
    const warm = new FileAgentTimelineStore(resolveDirectory);
    const tail = await warm.fetchProjectedCommitted("history", { limit: 40 });
    assert(tail.startSeq !== null, "Fixture must have a nonempty projected tail");
    const beforeLatencies: number[] = [];
    for (let index = 0; index < samples; index++) {
      const start = performance.now();
      await warm.fetchProjectedCommitted("history", { limit: 40 });
      sample.acknowledge(performance.now() - start, 0);
      const olderStart = performance.now();
      const older = await warm.fetchProjectedCommitted("history", {
        direction: "before",
        cursor: { epoch, seq: tail.startSeq },
        limit: 40,
      });
      if (tail.hasOlder) assert(older.entries.length > 0);
      beforeLatencies.push(performance.now() - olderStart);
    }
    return {
      pageSize: 40,
      beforeLatenciesMs: beforeLatencies,
      beforeP95Ms: percentile(beforeLatencies, 0.95),
    };
  });
  await phase(`current.timeline.rebuild-canonical-index.${count}`, async (sample) => {
    await store.flush();
    SessionEventLog.forgetAll();
    await fs.rm(path.join(directory, "events.index.json"), { force: true });
    const start = performance.now();
    const page = await new FileAgentTimelineStore(resolveDirectory).fetchProjectedCommitted(
      "history",
      { limit: 40 },
    );
    assert.equal(page.epoch, epoch);
    assert.equal(page.endSeq, count);
    sample.acknowledge(performance.now() - start, 0);
    return { destructiveIndexRemovalOnly: true, acknowledgedCanonicalRows: count };
  });
}

export async function writerBenchmarks(
  context: BenchmarkContext,
  options: { writerRows: number; cycles: number; owners: number; writersOnly?: boolean },
) {
  const { root, phase } = context;
  const store = new FileAgentTimelineStore(async (id) => path.join(root, "writers", id));
  await phase("current.timeline.10-concurrent-writers", async (sample) => {
    await parallelIndices(10, 10, async (writer) => {
      const id = `writer-${writer}`;
      for (let seq = 1; seq <= options.writerRows; seq++) {
        const row = mixedRow(seq);
        const start = performance.now();
        const committed = await store.appendCommitted(id, row.item, {
          timestamp: row.timestamp,
          turnId: row.turnId,
        });
        assert.equal(committed.seq, seq);
        sample.acknowledge(performance.now() - start, Buffer.byteLength(JSON.stringify(row)));
      }
      assert.equal(await store.getLatestCommittedSeq(id), options.writerRows);
      await verifyCanonical(
        new FileAgentTimelineStore(async (agentId) => path.join(root, "writers", agentId)),
        id,
        options.writerRows,
      );
    });
    return {
      writers: 10,
      rowsPerWriter: options.writerRows,
      perWriterOutstandingCalls: 1,
      droppedOrEarlyAcknowledgedRows: 0,
      scope: "FileStore only; daemon/provider queue layers excluded",
    };
  });
  // The daemon enqueues each timeline row without waiting for the previous one, so rows that
  // arrive while an append is in flight can share its successor's fsync.
  await phase("current.timeline.10-pipelined-writers", async (sample) => {
    const pipelined = new FileAgentTimelineStore(async (id) => path.join(root, "pipelined", id));
    await parallelIndices(10, 10, async (writer) => {
      const id = `writer-${writer}`;
      // Ten writers × 100 outstanding rows stays under every store admission limit, including
      // the single 1,024-operation cap older builds had, so before/after runs are comparable.
      for (let first = 1; first <= options.writerRows; first += PIPELINE_BURST_ROWS) {
        const writes: Promise<void>[] = [];
        const last = Math.min(options.writerRows, first + PIPELINE_BURST_ROWS - 1);
        for (let seq = first; seq <= last; seq++) {
          const row = mixedRow(seq);
          const start = performance.now();
          writes.push(
            pipelined.bulkInsert(id, [row]).then(() => {
              sample.acknowledge(performance.now() - start, Buffer.byteLength(JSON.stringify(row)));
              return undefined;
            }),
          );
        }
        await Promise.all(writes);
      }
      await verifyCanonical(
        new FileAgentTimelineStore(async (agentId) => path.join(root, "pipelined", agentId)),
        id,
        options.writerRows,
      );
    });
    return {
      writers: 10,
      rowsPerWriter: options.writerRows,
      perWriterOutstandingCalls: PIPELINE_BURST_ROWS,
      scope: "FileStore only; daemon/provider queue layers excluded",
    };
  });
  if (options.writersOnly) return;
  const retained = new FileAgentTimelineStore(async (id) => path.join(root, "retention", id));
  for (let index = 0; index < options.owners; index++)
    await retained.bulkInsert(`owner-${index}`, [mixedRow(1)]);
  const steadyHeap: number[] = [];
  const steadyRss: number[] = [];
  for (let cycle = 0; cycle < options.cycles; cycle++) {
    await phase(`current.timeline.retained-owner-cycle.${cycle}`, async (sample) => {
      for (let index = 0; index < options.owners; index++) {
        const start = performance.now();
        const page = await retained.fetchProjectedCommitted(`owner-${index}`, { limit: 40 });
        assert.equal(page.endSeq, 1);
        sample.acknowledge(performance.now() - start, 0);
      }
      return {
        ownersVisited: options.owners,
        residentOwners: SessionEventLog.residentCount,
        budget: SessionEventLog.residentLimit,
      };
    });
    globalThis.gc?.();
    const memory = process.memoryUsage();
    steadyHeap.push(memory.heapUsed);
    steadyRss.push(memory.rss);
  }
  const allowedGrowth = Math.max(8 * 1024 * 1024, steadyHeap[0]! * 0.2);
  await phase("current.timeline.retention-summary", async () => ({
    steadyHeap,
    steadyRss,
    allowedGrowthBytes: allowedGrowth,
    heapPlateauObserved: steadyHeap.at(-1)! - steadyHeap[0]! <= allowedGrowth,
    exposedGc: typeof globalThis.gc === "function",
    scope: "Retained FileStore owners only; not all daemon/app/provider memory",
  }));
}
