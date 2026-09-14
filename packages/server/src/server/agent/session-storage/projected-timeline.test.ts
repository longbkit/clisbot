import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import { projectTimelineRows, selectProjectedTimelinePage } from "../timeline-projection.js";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";
import { SessionEventLog } from "./session-event-log.js";

const directories: string[] = [];
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "projected-timeline-"));
  directories.push(directory);
  return { directory, store: new FileAgentTimelineStore(async () => directory) };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});
function message(seq: number, text = `${seq}`): AgentTimelineRow {
  return {
    seq,
    timestamp: "2026-09-11T00:00:00Z",
    turnId: "turn",
    item: { type: "assistant_message", text, messageId: `${seq}` },
  };
}
function tool(seq: number, callId: string, status: "running" | "completed"): AgentTimelineRow {
  return {
    seq,
    timestamp: "2026-09-11T00:00:00Z",
    turnId: "turn",
    item: {
      type: "tool_call",
      callId,
      name: "shell",
      status,
      detail: { type: "unknown", input: {}, output: null },
      error: null,
    },
  };
}
function mixedRow(seq: number): AgentTimelineRow {
  const block = Math.floor((seq - 1) / 100);
  if (seq % 100 === 1) return tool(seq, `tool-${block}`, "running");
  if (seq % 100 === 0) return tool(seq, `tool-${block}`, "completed");
  return {
    ...message(seq),
    item: { type: "assistant_message", text: ".", messageId: `message-${Math.floor(seq / 5)}` },
  };
}
async function expectGolden(store: FileAgentTimelineStore, rows: AgentTimelineRow[]) {
  const epoch = await store.getEpoch("a");
  for (const direction of ["tail", "before", "after"] as const) {
    for (const cursorSeq of [0, 1, 3, 8, rows.length - 1, rows.length, rows.length + 1]) {
      for (const limit of [1, 2, 4, 40]) {
        const actual = await store.fetchProjectedCommitted("a", {
          direction,
          limit,
          cursor: { epoch, seq: cursorSeq },
        });
        const expected = selectProjectedTimelinePage({ rows, direction, cursorSeq, limit });
        expect(
          {
            entries: actual.entries,
            startSeq: actual.startSeq,
            endSeq: actual.endSeq,
            hasOlder: actual.hasOlder,
            hasNewer: actual.hasNewer,
          },
          `${direction}/${cursorSeq}/${limit}`,
        ).toEqual(expected);
      }
    }
  }
}
describe("durable projected timeline", () => {
  it("matches golden projection with chunk merges, overlapping tools, and repeated call IDs across turns", async () => {
    const { directory, store } = await fixture();
    const rows = [
      message(1),
      tool(2, "first", "running"),
      message(3),
      message(4),
      tool(5, "second", "running"),
      message(6),
      tool(7, "first", "completed"),
      message(8),
      tool(9, "second", "completed"),
      message(10),
      message(11),
      message(12),
    ];
    rows[3].item = { type: "assistant_message", text: "chunk" };
    rows[9].item = { type: "reasoning", text: "a" };
    rows[10].item = { type: "reasoning", text: "b" };
    rows.push(
      { ...tool(13, "first", "running"), turnId: "other" },
      { ...tool(14, "first", "completed"), turnId: "other" },
    );
    for (const row of rows) await store.bulkInsert("a", [row]);
    await expectGolden(store, rows);
    await expectGolden(new FileAgentTimelineStore(async () => directory), rows);
  });
  it("rebuilds a deleted or corrupt canonical index and keeps the epoch across an enrichment", async () => {
    const { directory, store } = await fixture();
    const rows = [message(1), message(2), message(3)];
    await store.bulkInsert("a", rows);
    const epoch = await store.getEpoch("a");
    await fs.writeFile(path.join(directory, "events.index.json"), "broken");
    await expectGolden(new FileAgentTimelineStore(async () => directory), rows);
    await fs.rm(path.join(directory, "events.index.json"));
    await expectGolden(new FileAgentTimelineStore(async () => directory), rows);
    rows[0] = {
      ...rows[0],
      item: {
        type: "user_message",
        text: "hello",
        clientMessageId: "client",
        sender: { kind: "user", id: "me", displayName: "Me" },
      },
    };
    await store.updateCommittedRow("a", rows[0]);
    expect(await store.getEpoch("a")).toBe(epoch);
    await expectGolden(store, rows);
    const next = [message(1), message(2, "replacement")];
    await store.replaceCommitted("a", next);
    expect(await store.getEpoch("a")).not.toBe(epoch);
    const reset = await store.fetchProjectedCommitted("a", {
      cursor: { epoch, seq: 2 },
      direction: "after",
      limit: 40,
    });
    expect(reset.reset).toBe(true);
    expect(reset.entries).toEqual(
      selectProjectedTimelinePage({ rows: next, direction: "tail", limit: 40 }).entries,
    );
  });
  it("completes an ancient tool lifecycle after the index that located it is rebuilt", async () => {
    const { directory, store } = await fixture();
    const rows = [tool(1, "ancient", "running"), message(2), tool(3, "other", "running")];
    await store.bulkInsert("a", rows);
    await fs.rm(path.join(directory, "events.index.json"));
    rows.push(tool(4, "ancient", "completed"));
    await store.bulkInsert("a", [rows.at(-1)!]);
    await expectGolden(store, rows);
    await fs.writeFile(path.join(directory, "events.index.json"), '{"version":1,"anchors":[]}');
    rows.push(tool(5, "ancient", "completed"));
    await new FileAgentTimelineStore(async () => directory).bulkInsert("a", [rows.at(-1)!]);
    await expectGolden(new FileAgentTimelineStore(async () => directory), rows);
  });
  it("counts forty projected entries across hundreds of canonical chunks", async () => {
    const { store } = await fixture();
    const rows = Array.from({ length: 800 }, (_, index) => ({
      ...message(index + 1),
      item: {
        type: "assistant_message" as const,
        text: ".",
        messageId: `${Math.floor(index / 20)}`,
      },
    }));
    for (let index = 0; index < rows.length; index += 128)
      await store.bulkInsert("a", rows.slice(index, index + 128));
    const page = await store.fetchProjectedCommitted("a", { limit: 40 });
    expect(page.entries).toHaveLength(40);
    expect(page.startSeq).toBe(1);
    expect(page.endSeq).toBe(800);
    expect(page.entries).toEqual(
      selectProjectedTimelinePage({ rows, direction: "tail", limit: 40 }).entries,
    );
  });
  it("source-range pages recover every item around an ancient updated tool without certifying its gap", async () => {
    const { store } = await fixture();
    const rows = [
      tool(1, "ancient", "running"),
      ...Array.from({ length: 98 }, (_, index) => message(index + 2)),
      tool(100, "ancient", "completed"),
    ];
    await store.bulkInsert("a", rows);
    const epoch = await store.getEpoch("a");
    const tail = await store.fetchProjectedCommitted("a", {
      pagingMode: "source_ranges",
      limit: 4,
    });
    expect(tail.startSeq).toBe(97);
    expect(tail.endSeq).toBe(100);
    expect(tail.entries.map((entry) => entry.seqStart)).toEqual([97, 98, 99]);
    expect(tail.contextEntries?.[0].sourceSeqRanges).toEqual([
      { startSeq: 1, endSeq: 1 },
      { startSeq: 100, endSeq: 100 },
    ]);
    expect(tail.hasOlder).toBe(true);
    const contextOnly = await store.fetchProjectedCommitted("a", {
      pagingMode: "source_ranges",
      limit: 1,
    });
    expect(contextOnly.entries).toEqual([]);
    expect(contextOnly.contextEntries).toHaveLength(1);
    expect([contextOnly.startSeq, contextOnly.endSeq, contextOnly.hasOlder]).toEqual([
      100,
      100,
      true,
    ]);
    const reset = await store.fetchProjectedCommitted("a", {
      pagingMode: "source_ranges",
      direction: "after",
      cursor: { epoch: "stale", seq: 99 },
      limit: 1,
    });
    expect(reset.reset).toBe(true);
    expect(reset.entries).toEqual([]);
    expect([reset.startSeq, reset.endSeq]).toEqual([100, 100]);
    const all = new Map(
      [...tail.entries, ...(tail.contextEntries ?? [])].map((entry) => [entry.seqStart, entry]),
    );
    let previous = tail;
    while (previous.hasOlder) {
      const page = await store.fetchProjectedCommitted("a", {
        pagingMode: "source_ranges",
        direction: "before",
        cursor: { epoch, seq: previous.startSeq! },
        limit: 4,
      });
      expect(page.endSeq).toBe(previous.startSeq! - 1);
      for (const entry of [...page.entries, ...(page.contextEntries ?? [])])
        all.set(entry.seqStart, entry);
      previous = page;
    }
    expect([...all].sort(([left], [right]) => left - right).map(([, entry]) => entry)).toEqual(
      projectTimelineRows({ rows, mode: "projected" }),
    );
    const after = await store.fetchProjectedCommitted("a", {
      pagingMode: "source_ranges",
      direction: "after",
      cursor: { epoch, seq: 96 },
      limit: 4,
    });
    expect(after.startSeq).toBe(97);
    expect(after.endSeq).toBe(100);
    expect(after.contextEntries).toEqual(tail.contextEntries);
    const legacy = await store.fetchProjectedCommitted("a", { limit: 4 });
    expect(legacy.startSeq).toBe(1);
    expect(legacy.entries).toHaveLength(99);
  });
  // Required gates are 1,000 and 10,000 rows; 100,000 is an optional ceiling diagnostic
  // that only runs under PASEO_SESSION_STORAGE_CEILING. See the iteration benchmark contract.
  for (const canonicalRows of [1_000, 10_000, 100_000]) {
    const ceiling = canonicalRows > 10_000;
    (ceiling && !process.env.PASEO_SESSION_STORAGE_CEILING ? it.skip : it)(
      `reads a bounded cold projected page over ${canonicalRows} canonical rows`,
      async () => {
        const { directory, store } = await fixture();
        for (let start = 1; start <= canonicalRows; start += 256) {
          await store.bulkInsert(
            "a",
            Array.from({ length: Math.min(256, canonicalRows + 1 - start) }, (_, index) =>
              mixedRow(start + index),
            ),
          );
        }
        const originalOpen = fs.open.bind(fs);
        const originalReadFile = fs.readFile.bind(fs);
        let sourceBytes = 0;
        let derivedBytes = 0;
        const chargeTo = (target: string, size: number) => {
          if (target.endsWith("events.index.json")) derivedBytes += size;
          else sourceBytes += size;
        };
        vi.spyOn(fs, "readFile").mockImplementation((async (
          ...args: Parameters<typeof fs.readFile>
        ) => {
          const result = await originalReadFile(...args);
          chargeTo(
            String(args[0]),
            typeof result === "string" ? Buffer.byteLength(result) : result.byteLength,
          );
          return result;
        }) as typeof fs.readFile);
        vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
          const handle = await originalOpen(...args);
          const originalRead = handle.read.bind(handle);
          handle.read = (async (...readArgs: Parameters<typeof handle.read>) => {
            const result = await originalRead(...readArgs);
            chargeTo(String(args[0]), result.bytesRead);
            return result;
          }) as typeof handle.read;
          return handle;
        });
        await store.flush();
        SessionEventLog.forgetAll();
        const cold = new FileAgentTimelineStore(async () => directory);
        const started = performance.now();
        const page = await cold.fetchProjectedCommitted("a", { limit: 40 });
        const expected = selectProjectedTimelinePage({
          rows: Array.from({ length: canonicalRows }, (_, index) => mixedRow(index + 1)),
          direction: "tail",
          limit: 40,
        });
        expect(page.entries).toEqual(expected.entries);
        expect(page.startSeq).toBe(expected.startSeq);
        expect(page.endSeq).toBe(canonicalRows);
        const metrics = {
          benchmark: "projected-cold-owner-warm-filesystem",
          canonicalRows,
          returnedEntries: page.entries.length,
          readMs: performance.now() - started,
          sourceBytes,
          derivedBytes,
          rssBytes: process.memoryUsage().rss,
        };
        if (process.env.PASEO_SESSION_STORAGE_METRICS)
          await fs.appendFile(
            process.env.PASEO_SESSION_STORAGE_METRICS,
            `${JSON.stringify(metrics)}\n`,
          );
        // A tail page reads its own window, not the history behind it.
        expect(sourceBytes).toBeLessThan(2 * 1024 * 1024);

        // The oldest tool now reaches across the entire journal. Source-range mode
        // resolves it by canonical id without certifying the intervening history.
        await store.bulkInsert("a", [tool(canonicalRows + 1, "tool-0", "completed")]);
        const ancient = await new FileAgentTimelineStore(
          async () => directory,
        ).fetchProjectedCommitted("a", { pagingMode: "source_ranges", limit: 40 });
        expect(ancient.entries.length + (ancient.contextEntries?.length ?? 0)).toBeLessThanOrEqual(
          40,
        );
        expect(ancient.endSeq).toBe(canonicalRows + 1);
        expect(ancient.hasOlder).toBe(true);
        expect(
          ancient.contextEntries?.find((entry) => entry.seqStart === 1)?.sourceSeqRanges,
        ).toEqual([
          { startSeq: 1, endSeq: 1 },
          { startSeq: 100, endSeq: 100 },
          { startSeq: canonicalRows + 1, endSeq: canonicalRows + 1 },
        ]);
      },
      ceiling ? 300_000 : 120_000,
    );
  }
});
