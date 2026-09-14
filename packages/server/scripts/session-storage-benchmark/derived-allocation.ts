/** Modest through-store probe before attempting a 100k long-document dataset. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { FileAgentTimelineStore } from "../../src/server/agent/session-storage/file-agent-timeline-store.js";
import type { AgentTimelineRow } from "../../src/server/agent/agent-timeline-store-types.js";
import { instrumentReads, measure } from "./metrics.js";
import { command, sourceState } from "./source-state.js";

const root = path.resolve(
  process.argv[2] ?? path.join(os.tmpdir(), `session-derived-allocation-${Date.now()}`),
);
const count = Number(process.argv[3] ?? "1000");
assert(Number.isSafeInteger(count) && count >= 400 && count <= 1000 && count % 4 === 0);
await fs.mkdir(root, { recursive: true });
assert.equal((await fs.readdir(root)).length, 0, "Probe data directory must be empty");
const sourceStart = sourceState();
const startedAt = new Date().toISOString();
const store = new FileAgentTimelineStore(async (id) => path.join(root, id));
const chunk = "growing reply 😀\n".repeat(128);
function row(seq: number): AgentTimelineRow {
  if (seq <= count / 2)
    return {
      seq,
      turnId: "reply",
      timestamp: "2026-09-12",
      item: { type: "assistant_message", text: chunk },
    };
  if (seq % 2 === 0)
    return {
      seq,
      turnId: "tool",
      timestamp: "2026-09-12",
      item: {
        type: "tool_call",
        callId: "ancient",
        name: "shell",
        status: "running",
        error: null,
        detail: { type: "shell", command: "work", output: `step${seq}` },
        metadata: { [`field${seq}`]: "data".repeat(256) },
      },
    };
  return {
    seq,
    timestamp: "2026-09-12",
    item: { type: "user_message", text: `interleaved ${seq}` },
  };
}
interface Allocation {
  files: number;
  directories: number;
  logicalBytes: number;
  allocatedBytes: number;
}
async function allocation(directory: string): Promise<Record<string, Allocation>> {
  const result: Record<string, Allocation> = {};
  async function walk(current: string) {
    const handle = await fs.opendir(current);
    for await (const entry of handle) {
      const file = path.join(current, entry.name);
      const stat = await fs.lstat(file);
      const relative = path.relative(directory, file);
      let category: string;
      if (relative.includes(`${path.sep}documents${path.sep}`) || entry.name === "documents") {
        category = "derivedDocuments";
      } else if (relative.split(path.sep).includes("projection")) {
        category = "otherProjection";
      } else {
        category = "canonicalAndPrivateIndexes";
      }
      const summary = (result[category] ??= {
        files: 0,
        directories: 0,
        logicalBytes: 0,
        allocatedBytes: 0,
      });
      summary.allocatedBytes += stat.blocks * 512;
      if (entry.isDirectory()) {
        summary.directories += 1;
        await walk(file);
      } else {
        assert(entry.isFile(), `Unexpected probe entry ${relative}`);
        summary.files += 1;
        summary.logicalBytes += stat.size;
      }
    }
  }
  await walk(directory);
  return result;
}
const io = instrumentReads();
let failure: string | undefined;
const phases: unknown[] = [];
try {
  phases.push(
    await measure("durable bulk append and derived projection", async ({ acknowledge }) => {
      for (let start = 1; start <= count; start += 20) {
        const rows = Array.from({ length: Math.min(20, count - start + 1) }, (_, index) =>
          row(start + index),
        );
        const bytes = Buffer.byteLength(JSON.stringify(rows));
        const began = performance.now();
        await store.bulkInsert("agent", rows);
        acknowledge(performance.now() - began, bytes, rows.length);
        if ((start - 1 + rows.length) % 100 === 0)
          process.stdout.write(`Acknowledged ${start - 1 + rows.length}/${count}\n`);
      }
      return { nodeIo: io.snapshot() };
    }),
  );
  io.reset();
  phases.push(
    await measure("cold valid-index descriptors and bounded document/range reads", async () => {
      const cold = new FileAgentTimelineStore(async (id) => path.join(root, id));
      const epoch = await cold.getEpoch("agent");
      const reply = await cold.fetchProjectedCommitted("agent", {
        pagingMode: "source_ranges",
        allowDeferredPayloads: true,
        direction: "before",
        cursor: { epoch, seq: count / 2 + 1 },
        limit: 1,
      });
      const descriptor = reply.entries[0]?.deferredPayload;
      assert(descriptor, "Long reply must return an explicit descriptor");
      const document = await cold.readProjectedPayload("agent", {
        epoch,
        id: descriptor.id,
        offset: 0,
        limit: 65536,
      });
      assert.equal(
        document.totalBytes,
        Buffer.byteLength(
          JSON.stringify({ type: "assistant_message", text: chunk.repeat(count / 2) }),
        ),
      );
      assert(Buffer.byteLength(document.text) <= 65536);
      const tail = await cold.fetchProjectedCommitted("agent", {
        pagingMode: "source_ranges",
        allowDeferredPayloads: true,
        limit: 2,
      });
      assert.equal(tail.endSeq, count);
      const tool = [...tail.entries, ...(tail.contextEntries ?? [])].find(
        (entry) => entry.item.type === "tool_call",
      );
      assert(tool?.deferredPayload, "Growing tool metadata must return a descriptor");
      if (count >= 520) {
        assert(tool.sourceSeqRangesRef, "Disjoint ranges must return an exact range reference");
        const ranges = await cold.readProjectedSourceRanges("agent", {
          epoch,
          id: tool.sourceSeqRangesRef.id,
          limit: 128,
        });
        assert.equal(ranges.totalCount, count / 4);
        assert.equal(ranges.ranges.length, 128);
      }
      // Verify every canonical row with fixed-size pages; no prefix truncation accepted.
      for (let seq = 1; seq <= count; seq += 20) {
        const page = await cold.fetchCommitted("agent", {
          direction: "after",
          cursor: { epoch, seq: seq - 1 },
          limit: 20,
        });
        assert.deepEqual(
          page.rows,
          Array.from({ length: Math.min(20, count - seq + 1) }, (_, index) => row(seq + index)),
        );
      }
      return {
        nodeIo: io.snapshot(),
        replyPayloadBytes: descriptor.byteLength,
        toolPayloadBytes: tool.deferredPayload.byteLength,
      };
    }),
  );
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  io.restore();
  const disk = await allocation(root);
  const report = {
    startedAt,
    endedAt: new Date().toISOString(),
    failure,
    sourceStart,
    sourceEnd: sourceState(),
    root,
    count,
    dataset:
      "Half continuous Unicode reply chunks; half alternating user rows and one ancient tool with distinct growing metadata fields/ranges. Bulk20 durable acknowledgements; every canonical row verified.",
    environment: {
      node: process.version,
      execArgv: process.execArgv,
      platform: process.platform,
      kernel: os.release(),
      architecture: process.arch,
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      filesystem: command("findmnt", ["-T", root, "-o", "TARGET,SOURCE,FSTYPE,OPTIONS", "-n"]),
      cache: "Fresh owner; OS page cache warmed by writes; no device cache flush",
      build:
        "Production TypeScript via tsx, not a packaged production daemon; no provider or browser process",
    },
    phases,
    disk,
    extrapolation: {
      warning:
        "Arithmetic size/row extrapolation only; tree height, key diversity and update pattern change growth. No 100k completion claim.",
      at100kRows: Object.fromEntries(
        Object.entries(disk).map(([key, value]) => [
          key,
          {
            files: Math.ceil((value.files * 100000) / count),
            allocatedBytes: (value.allocatedBytes * 100000) / count,
          },
        ]),
      ),
    },
    instrumentation:
      "Successful public promises.fs open/writeFile and FileHandle write/writeFile/sync calls only; internal Node opens, failed wx dedup attempts and stream internals excluded. File blocks*512 is filesystem allocated space including node/directory overhead, not physical device write amplification. OS /proc phase deltas include metric reads. 25ms memory samples include harness.",
  };
  await fs.writeFile(path.join(root, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report ${path.join(root, "report.json")}\n`);
}
