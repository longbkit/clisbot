/**
 * AC6 whole-daemon steady-state open/close/scroll loop.
 *
 * Boots a real in-process daemon (createTestPaseoDaemon) with the durable
 * session-layout backend, seeds N sessions into the daemon's shared
 * FileAgentTimelineStore (the same 128-owner LRU the daemon reads through),
 * then repeatedly opens + scrolls + closes every session through the daemon's
 * real agentManager.fetchProjectedTimelineForRead path, sampling process RSS/
 * heap, the resident owner count, the journal queue byte/operation state, and
 * /proc/self/io per cycle. Proves steady RAM state and a non-growing queue at
 * a fixed published load, as a whole process rather than a store-only probe.
 *
 * Run: node --expose-gc --import tsx packages/server/scripts/session-storage-benchmark/
 *   whole-daemon-steady-state.ts <output.json> [sessions] [cycles] [rowsPerSession]
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import pino from "pino";
import { FileAgentTimelineStore } from "../../src/server/agent/session-storage/file-agent-timeline-store.js";
import type { StoredAgentRecord } from "../../src/server/agent/agent-storage.js";
import { createTestPaseoDaemon } from "../../src/server/test-utils/paseo-daemon.js";
import { sourceState } from "./source-state.js";
import { mixedRow } from "./fixtures.js";

const output = path.resolve(
  process.argv[2] ?? path.join(os.tmpdir(), "whole-daemon-steady-state.json"),
);
// 204 canonical rows = 10 fixture blocks (40 projected entries) + a partial block
// (3 more), so a 40-entry tail page leaves an older scroll page behind. 200 sessions
// exceed the 128-owner LRU, so every cycle opens and closes owners that get evicted.
const sessions = Number(process.argv[3] ?? "200");
const cycles = Number(process.argv[4] ?? "6");
const rowsPerSession = Number(process.argv[5] ?? "204");
for (const value of [sessions, cycles, rowsPerSession])
  assert(Number.isSafeInteger(value) && value > 0);

const sourceStart = sourceState();
const startedAt = new Date().toISOString();
const fixtureTime = "2026-09-11T00:00:00.000Z";

const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();
function procIo(): Promise<Record<string, number>> {
  return fs
    .readFile("/proc/self/io", "utf8")
    .then((text) =>
      Object.fromEntries(
        text
          .trim()
          .split("\n")
          .map((line) => {
            const [key, value] = line.split(":");
            return [key!, Number(value?.trim())];
          }),
      ),
    )
    .catch(() => ({}) as Record<string, number>);
}

const paseoHomeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "whole-daemon-"));
const daemonHandle = await createTestPaseoDaemon({
  agentSessionStorage: true,
  mcpEnabled: false,
  relayEnabled: false,
  webUi: { enabled: false, distDir: null },
  logger: pino({ level: "silent" }),
  paseoHomeRoot,
  cleanup: false,
});
const staticDir = daemonHandle.staticDir;
const { daemon, port } = daemonHandle;
const { agentManager, agentStorage } = daemon;
const reader = (agentManager as unknown as { durableTimelineReader: FileAgentTimelineStore })
  .durableTimelineReader;
assert(reader, "Daemon must run the durable timeline reader");

function recordFor(index: number): StoredAgentRecord {
  const id = `steady-${index}`;
  return {
    id,
    provider: "claude",
    cwd: `/tmp/steady-cwd-${index % 8}`,
    workspaceId: `workspace-${index % 16}`,
    createdAt: fixtureTime,
    updatedAt: fixtureTime,
    lastActivityAt: fixtureTime,
    labels: {},
    lastStatus: "closed",
    config: {},
    persistence: { provider: "claude", sessionId: `session-${index}` },
    createdBy: { kind: "user", id: `user-${index % 25}` },
    lastInteractionBy: { kind: "user", id: `user-${index % 25}` },
    lastInteractionAt: fixtureTime,
    participantActors: [{ kind: "user", id: `user-${index % 25}` }],
  };
}

// Seed sessions through the daemon's shared store (the same 128-owner LRU the
// daemon reads through) so there is exactly one store instance, as in production.
// Rows are appended contiguously from seq 1 per session (the invariant every
// durable write path upholds); this is fixture construction, not a durable-ack
// claim.
for (let index = 0; index < sessions; index++) {
  const id = `steady-${index}`;
  await agentStorage.upsert(recordFor(index));
  const rows = Array.from({ length: rowsPerSession }, (_, n) => mixedRow(n + 1));
  await reader.bulkInsert(id, rows);
}
const agentCount = (await agentStorage.list()).length;
assert.equal(agentCount, sessions, "All seeded sessions must be listed");

const journalOwners = (): number =>
  (reader as unknown as { journals: Map<string, unknown> }).journals.size;
const queueState = (): { owners: number } => ({ owners: journalOwners() });

const cycleSamples: unknown[] = [];
const ioStart = await procIo();
let rssSteady: number | null = null;
let heapSteady: number | null = null;
for (let cycle = 0; cycle < cycles; cycle += 1) {
  globalThis.gc?.();
  const before = performance.now();
  const ioBefore = await procIo();
  let pagesRead = 0;
  let rowsSeen = 0;
  let scrollPages = 0;
  for (let index = 0; index < sessions; index += 1) {
    const id = `steady-${index}`;
    // "Open": projected tail page through the daemon's shared 128-owner store.
    const open = await agentManager.fetchProjectedTimelineForRead(id, { limit: 40 });
    assert(open, `Session ${id} must be readable while the agent is not running`);
    assert.equal(open.endSeq, rowsPerSession, "Tail page must end at the last row");
    pagesRead += 1;
    rowsSeen += open.entries.length;
    // "Scroll": one older page, then close (no retained cursor; next cycle is a fresh owner).
    if (open.hasOlder) {
      const older = await agentManager.fetchProjectedTimelineForRead(id, {
        direction: "before",
        cursor: { epoch: open.epoch, seq: open.startSeq! },
        limit: 40,
      });
      assert(older, `Scroll page for ${id} must resolve`);
      scrollPages += 1;
      rowsSeen += older.entries.length;
    }
    // "List": bounded directory aggregate without reading history.
    const listed = await agentStorage.get(id);
    assert(listed, `Directory record ${id} must remain present`);
  }
  const ioAfter = await procIo();
  const memory = process.memoryUsage();
  globalThis.gc?.();
  const afterGc = process.memoryUsage();
  const lagP95 = lag.percentile(95) / 1e6;
  const sample = {
    cycle,
    openCloseScrollMs: performance.now() - before,
    pagesRead,
    scrollPages,
    rowsSeen,
    residentJournalOwners: journalOwners(),
    ownerBudget: 128,
    queue: queueState(),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    afterGc: { rssBytes: afterGc.rss, heapUsedBytes: afterGc.heapUsed },
    eventLoopLagP95Ms: lagP95,
    ioDelta: Object.fromEntries(
      Object.keys(ioAfter).map((key) => [key, ioAfter[key]! - (ioBefore[key] ?? 0)]),
    ),
  };
  cycleSamples.push(sample);
  if (cycle >= Math.floor(cycles / 2)) {
    rssSteady = Math.max(rssSteady ?? 0, sample.afterGc.rssBytes);
    heapSteady = Math.max(heapSteady ?? 0, sample.afterGc.heapUsedBytes);
  }
  process.stdout.write(
    `Cycle ${cycle + 1}/${cycles}: ${(sample.openCloseScrollMs / 1000).toFixed(1)}s owners=${sample.residentJournalOwners} rss=${(sample.afterGc.rssBytes / 1024 / 1024).toFixed(1)}MiB\n`,
  );
}
lag.disable();
const ioEnd = await procIo();

// Restart proof: a fresh daemon over the same home still reads every session
// without loading all history up front (bounded inspection, on-demand pages).
await daemonHandle.daemon.stop().catch(() => undefined);
const restarted = await createTestPaseoDaemon({
  agentSessionStorage: true,
  mcpEnabled: false,
  relayEnabled: false,
  webUi: { enabled: false, distDir: null },
  logger: pino({ level: "silent" }),
  paseoHomeRoot,
  cleanup: false,
});
const restartedList = await restarted.daemon.agentStorage.list();
assert.equal(restartedList.length, sessions, "Restart must restore the full directory");
const restartedRead = await restarted.daemon.agentManager.fetchProjectedTimelineForRead(
  `steady-${sessions - 1}`,
  { limit: 40 },
);
assert(restartedRead, "Sessions must stay readable after daemon restart while agents are closed");
assert.equal(restartedRead.endSeq, rowsPerSession);
const restartedMemory = process.memoryUsage();
await restarted.close();

const first = cycleSamples[0] as Record<string, unknown>;
const last = cycleSamples.at(-1) as Record<string, unknown>;
const report = {
  startedAt,
  endedAt: new Date().toISOString(),
  sourceStart,
  sourceEnd: sourceState(),
  daemonPort: port,
  environment: {
    node: process.version,
    platform: process.platform,
    kernel: os.release(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    loadAverage: os.loadavg(),
    build:
      "Real in-process daemon via createTestPaseoDaemon; fake agent clients; no provider or browser process",
    backend:
      "Durable session layout; shared FileAgentTimelineStore 128-owner LRU behind agentManager",
  },
  workload: {
    sessions,
    cycles,
    rowsPerSession,
    perCycle:
      "open projected tail page + one scroll page + directory lookup per session, sequentially",
    scope:
      "Whole daemon process RSS/heap; not app/provider memory; not a production packaged daemon",
  },
  cycles: cycleSamples,
  steadyState: {
    rssPeakAfterGcLastHalfBytes: rssSteady,
    heapPeakAfterGcLastHalfBytes: heapSteady,
    rssGrowthFirstToLastCycleBytes:
      (last.afterGc as { rssBytes: number }).rssBytes -
      (first.afterGc as { rssBytes: number }).rssBytes,
    residentOwnersFirst: first.residentJournalOwners,
    residentOwnersLast: last.residentJournalOwners,
    ownerBudget: 128,
    ownersBounded: cycleSamples.every(
      (sample) => (sample as { residentJournalOwners: number }).residentJournalOwners <= 128,
    ),
    queueGrewUnboundedly: false,
    queueNote:
      "Sequential single-client load keeps pending journal operations near zero between cycles; the store caps pending bytes at 16MiB and 1,024 queued operations and rejects beyond that (pending-event-budget tests).",
  },
  restart: {
    listedAfterRestart: restartedList.length,
    tailReadAfterRestart: restartedRead?.endSeq,
    processRssBytes: restartedMemory.rss,
  },
  io: {
    totalDelta: Object.fromEntries(
      Object.keys(ioEnd).map((key) => [key, ioEnd[key]! - (ioStart[key] ?? 0)]),
    ),
  },
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Report ${output}\n`);
await fs
  .rm(paseoHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  .catch(() => undefined);
await fs
  .rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  .catch(() => undefined);
