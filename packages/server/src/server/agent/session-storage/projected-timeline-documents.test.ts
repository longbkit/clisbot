import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import { ProviderSubagentPersistence } from "../provider-subagents/persistence.js";
import { projectTimelineRows } from "../timeline-projection.js";
import { ProjectedTimeline } from "./projected-timeline.js";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";
import { SessionEventLog, SessionEventStream } from "./session-event-log.js";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    SessionEventLog.forget(directory);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
async function fixture(rows: AgentTimelineRow[]) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "timeline-documents-"));
  directories.push(directory);
  const store = new FileAgentTimelineStore(async () => directory);
  for (let start = 0; start < rows.length; start += 32)
    await store.bulkInsert("a", rows.slice(start, start + 32));
  return { directory, store };
}
function message(seq: number, size = 16 * 1024): AgentTimelineRow {
  return {
    seq,
    timestamp: "2026-09-11T00:00:00Z",
    turnId: "turn",
    item: { type: "assistant_message", text: "x".repeat(size), messageId: String(seq) },
  };
}
function tool(seq: number, output: string | null = null): AgentTimelineRow {
  return {
    ...message(seq, 0),
    item: {
      type: "tool_call",
      callId: "ancient",
      name: "shell",
      status: "completed",
      detail: { type: "unknown", input: {}, output },
      error: null,
    },
  };
}
function trackReads() {
  let bytes = 0;
  const original = SessionEventStream.prototype.read;
  vi.spyOn(SessionEventStream.prototype, "read").mockImplementation(async function (start, end) {
    const page = await original.call(this, start, end);
    bytes += page.reduce((sum, row) => sum + JSON.stringify(row.value).length * 2, 0);
    return page;
  });
  return {
    reset: () => {
      bytes = 0;
    },
    bytes: () => bytes,
  };
}

describe("projected timeline documents", () => {
  it("batches 9000 interleaved subagent updates and preserves all main entries", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => message(i + 1, 16));
    for (let i = 0; i < 9000; i++) {
      const row = tool(rows.length + 1, "x".repeat(2200));
      if (row.item.type === "tool_call") row.item.callId = `child-${i % 3}`;
      rows.push(row);
    }
    const { store } = await fixture(rows);
    const read = vi.spyOn(SessionEventStream.prototype, "read");
    const page = await store.fetchProjectedCommitted("a", {
      pagingMode: "source_ranges",
      limit: 40,
    });
    expect(page.entries).toEqual(projectTimelineRows({ rows, mode: "projected" }).slice(-40));
    expect(read.mock.calls.length).toBeLessThan(65);
  }, 30_000);

  it("pages across certified empty seqs without treating tool envelopes as read", async () => {
    const rows = [message(1, 10), message(3, 10), tool(100), message(120, 10), tool(300)];
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "timeline-gap-"));
    directories.push(directory);
    const log = SessionEventLog.for(directory);
    await log.append(
      "timeline",
      rows.map((value) => ({ seq: value.seq, value })),
    );
    const timeline = new ProjectedTimeline(log.stream<AgentTimelineRow>("timeline"));
    const expected = projectTimelineRows({ rows, mode: "projected" });
    const tail = await timeline.fetch({ pagingMode: "source_ranges", limit: 40 });
    expect(tail.entries).toEqual(expected);
    const forward = await timeline.fetch({
      pagingMode: "source_ranges",
      direction: "after",
      cursor: { epoch: tail.epoch, seq: 1 },
      limit: 40,
    });
    expect(forward.entries).toEqual(expected.slice(1));
  });

  it("keeps reused callIds in turns a, b, a separate and detects missing tool pointers", async () => {
    const rows = [tool(1, "a1"), tool(2, "a2"), tool(3, "b"), tool(4, "a3")];
    rows[0]!.turnId = rows[1]!.turnId = rows[3]!.turnId = "a";
    rows[2]!.turnId = "b";
    const { directory, store } = await fixture(rows);
    expect(
      (await store.fetchProjectedCommitted("a", { pagingMode: "source_ranges", limit: 40 }))
        .entries,
    ).toEqual(projectTimelineRows({ rows, mode: "projected" }));
    await SessionEventLog.for(directory).flush();
    const indexPath = path.join(directory, "events.index.json");
    const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
    index.tools.ancient = [1, 2, 3];
    await fs.writeFile(indexPath, JSON.stringify(index));
    SessionEventLog.forget(directory);
    const timeline = new ProjectedTimeline(
      SessionEventLog.for(directory).stream<AgentTimelineRow>("timeline"),
    );
    await expect(timeline.fetch({ pagingMode: "source_ranges", limit: 40 })).rejects.toThrow(
      "Incomplete tool occurrence index",
    );
  });

  it("pages a merged payload after restart without reading the oversized history", async () => {
    const rows = Array.from({ length: 1_500 }, (_, index) => message(index + 1));
    rows[1498] = message(1499, 40_000);
    rows[1499] = {
      ...message(1500),
      item: { type: "assistant_message", text: "y".repeat(40_000) },
    };
    const { directory, store } = await fixture(rows);
    const page = await store.fetchProjectedCommitted("a", {
      pagingMode: "source_ranges",
      limit: 40,
      allowDeferredPayloads: true,
    });
    const entry = page.entries.at(-1)!;
    expect(entry.deferredPayload).toBeDefined();
    expect(entry.deferredPayload!.id).toMatch(/^[a-f0-9]{64}$/);
    SessionEventLog.forget(directory);
    const restarted = new FileAgentTimelineStore(async () => directory);
    const reads = trackReads();
    let text = "";
    let offset: number | null = 0;
    while (offset !== null) {
      reads.reset();
      const part = await restarted.readProjectedPayload("a", {
        epoch: page.epoch,
        id: entry.deferredPayload!.id,
        offset,
        limit: 32_768,
      });
      text += part.text;
      offset = part.nextOffset;
      expect(reads.bytes()).toBeLessThan(3 * 1024 * 1024);
    }
    expect(JSON.parse(text)).toEqual({
      type: "assistant_message",
      messageId: "1499",
      text: "x".repeat(40_000) + "y".repeat(40_000),
    });
    await expect(
      restarted.readProjectedPayload("a", { epoch: "stale", id: entry.deferredPayload!.id }),
    ).rejects.toThrow("Stale timeline document epoch");
    const forged =
      entry.deferredPayload!.id.slice(0, -1) +
      (entry.deferredPayload!.id.endsWith("0") ? "1" : "0");
    await expect(
      restarted.readProjectedPayload("a", { epoch: page.epoch, id: forged }),
    ).rejects.toThrow("Invalid or stale projected document descriptor");
    // Continuing the same message changes the derived endpoint and invalidates the descriptor.
    await restarted.bulkInsert("a", [
      { ...message(1501), item: { type: "assistant_message", text: "more" } },
    ]);
    await expect(
      restarted.readProjectedPayload("a", { epoch: page.epoch, id: entry.deferredPayload!.id }),
    ).rejects.toThrow("Invalid or stale projected document descriptor");
  });

  it("resolves a distant tool payload and all source-range pages through its occurrence index", async () => {
    const rows = Array.from({ length: 1_500 }, (_, index) => message(index + 1));
    // 129 disjoint ranges require a deferred range descriptor, but fit the tool index.
    const seqs = [...Array.from({ length: 128 }, (_, index) => index * 4 + 1), 1500];
    // Only the last update is large; dependency reads must remain comfortably bounded.
    for (const seq of seqs) rows[seq - 1] = tool(seq, seq === 1500 ? "y".repeat(70_000) : null);
    const { directory, store } = await fixture(rows);
    const page = await store.fetchProjectedCommitted("a", {
      pagingMode: "source_ranges",
      limit: 1,
      allowDeferredPayloads: true,
    });
    const entry = page.contextEntries![0]!;
    expect(entry.sourceSeqRangesRef?.count).toBe(129);
    expect(entry.deferredPayload).toBeDefined();
    SessionEventLog.forget(directory);
    const restarted = new FileAgentTimelineStore(async () => directory);
    const reads = trackReads();
    const first = await restarted.readProjectedSourceRanges("a", {
      epoch: page.epoch,
      id: entry.sourceSeqRangesRef!.id,
      limit: 128,
    });
    const last = await restarted.readProjectedSourceRanges("a", {
      epoch: page.epoch,
      id: entry.sourceSeqRangesRef!.id,
      offset: first.nextOffset!,
    });
    expect([...first.ranges, ...last.ranges]).toEqual(
      seqs.map((seq) => ({ startSeq: seq, endSeq: seq })),
    );
    expect(last.nextOffset).toBeNull();
    expect(
      await restarted.readProjectedSourceRanges("a", {
        epoch: page.epoch,
        id: entry.sourceSeqRangesRef!.id,
        seq: 1500,
      }),
    ).toEqual({ ranges: [{ startSeq: 1500, endSeq: 1500 }], nextOffset: null, totalCount: 129 });
    expect(
      (
        await restarted.readProjectedPayload("a", {
          epoch: page.epoch,
          id: entry.deferredPayload!.id,
        })
      ).text,
    ).toContain('"type":"tool_call"');
    expect(reads.bytes()).toBeLessThan(2 * 1024 * 1024);
  });

  it("reaches main messages across more than 8192 trailing subagent updates", async () => {
    const rows = Array.from({ length: 50 }, (_, index) => message(index + 1, 16));
    for (let index = 0; index < 8300; index++) rows.push(tool(rows.length + 1, "x".repeat(2200)));
    const { store } = await fixture(rows);
    const expected = projectTimelineRows({ rows, mode: "projected" });
    const page = await store.fetchProjectedCommitted("a", {
      pagingMode: "source_ranges",
      limit: 40,
    });
    expect(
      [...page.entries, ...page.contextEntries!].sort((a, b) => a.seqStart - b.seqStart),
    ).toEqual(expected.slice(-40));
    const older = await store.fetchProjectedCommitted("a", {
      pagingMode: "source_ranges",
      direction: "before",
      limit: 40,
      cursor: { epoch: page.epoch, seq: page.startSeq! },
    });
    expect(older.entries).toEqual(expected.slice(0, 11));
    const forward = await store.fetchProjectedCommitted("a", {
      pagingMode: "source_ranges",
      direction: "after",
      limit: 40,
      cursor: { epoch: page.epoch, seq: older.endSeq! },
    });
    expect(
      [...forward.entries, ...forward.contextEntries!].sort((a, b) => a.seqStart - b.seqStart),
    ).toEqual(expected.slice(-40));
  });

  it("folds large repeated tool snapshots without retaining every historical payload", async () => {
    const rows = Array.from({ length: 600 }, (_, index) =>
      index % 2 === 0 ? tool(index + 1, "x".repeat(70_000)) : message(index + 1, 16),
    );
    const { store } = await fixture(rows);
    const expected = projectTimelineRows({ rows, mode: "projected" });
    for (const direction of ["tail", "before", "after"] as const) {
      const page = await store.fetchProjectedCommitted("a", {
        pagingMode: "source_ranges",
        direction,
        limit: 200,
      });
      for (const entry of [...page.entries, ...page.contextEntries!])
        expect(entry).toEqual(expected.find((value) => value.seqStart === entry.seqStart));
      expect(page.entries.length + page.contextEntries!.length).toBe(200);
    }
  });

  it("finds main messages behind a tail of subagent updates and isolates child journals", async () => {
    const rows = Array.from({ length: 1_200 }, (_, index) => message(index + 1));
    // The last 900 canonical rows contain only updates for three tools.
    for (let index = 0; index < 900; index++) {
      const row = tool(rows.length + 1, `update-${index}`);
      if (row.item.type !== "tool_call") throw new Error("Expected tool fixture");
      row.item.callId = `child-${index % 3}`;
      rows.push(row);
    }
    const { directory, store } = await fixture(rows);
    const children = new ProviderSubagentPersistence(async () => directory);
    const childRows = Array.from({ length: 300 }, (_, index) => tool(index + 1, "child only"));
    for (const row of childRows) {
      if (row.item.type !== "tool_call") throw new Error("Expected tool fixture");
      row.item.callId = "child-0";
    }
    await children.timelines.bulkInsert(JSON.stringify(["a", "child-0"]), childRows);
    const expected = projectTimelineRows({ rows, mode: "projected" });
    const page = await store.fetchProjectedCommitted("a", {
      pagingMode: "source_ranges",
      limit: 40,
    });
    expect(
      [...page.entries, ...page.contextEntries!].sort((a, b) => a.seqStart - b.seqStart),
    ).toEqual(expected.slice(-40));
    expect(page.entries.filter((entry) => entry.item.type === "assistant_message")).toHaveLength(
      37,
    );
    const older = await store.fetchProjectedCommitted("a", {
      pagingMode: "source_ranges",
      direction: "before",
      limit: 40,
      cursor: { epoch: page.epoch, seq: page.startSeq! },
    });
    expect(older.entries).toEqual(expected.slice(-80, -40));
    const newer = await store.fetchProjectedCommitted("a", {
      pagingMode: "source_ranges",
      direction: "after",
      limit: 40,
      cursor: { epoch: page.epoch, seq: older.endSeq! },
    });
    expect(
      [...newer.entries, ...newer.contextEntries!].sort((a, b) => a.seqStart - b.seqStart),
    ).toEqual(expected.slice(-40));
    const childPage = await children.fetchProjected("a", "child-0", {
      pagingMode: "source_ranges",
      limit: 40,
    });
    expect([...childPage.entries, ...childPage.contextEntries!]).toEqual(
      projectTimelineRows({ rows: childRows, mode: "projected" }),
    );
    expect(childPage.epoch).not.toBe(page.epoch);
    SessionEventLog.forget(await children.directory("a", "child-0"));
  });

  it.each([255, 256, 257, 509])(
    "loads %i tool updates from a legacy truncated index after restart",
    async (count) => {
      const rows = Array.from({ length: 1_500 }, (_, index) => message(index + 1));
      const seqs = [...Array.from({ length: count - 1 }, (_, index) => index * 2 + 1), 1500];
      for (const seq of seqs) rows[seq - 1] = tool(seq, seq === 1500 ? "z".repeat(70_000) : null);
      const { directory } = await fixture(rows);
      await SessionEventLog.flushAll();
      const indexPath = path.join(directory, "events.index.json");
      const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
      index.version = 2;
      index.tools.ancient = seqs.slice(0, 256);
      await fs.writeFile(indexPath, JSON.stringify(index));
      SessionEventLog.forget(directory);
      const store = new FileAgentTimelineStore(async () => directory);
      const reads = trackReads();
      const page = await store.fetchProjectedCommitted("a", {
        pagingMode: "source_ranges",
        limit: 40,
        allowDeferredPayloads: true,
      });
      const entry = page.contextEntries!.find((item) => item.seqStart === 1)!;
      expect(page.entries.length + page.contextEntries!.length).toBe(40);
      expect(entry.sourceSeqRangesRef?.count).toBe(count);
      expect(entry.deferredPayload).toBeDefined();
      expect(reads.bytes()).toBeLessThan(6 * 1024 * 1024);
      SessionEventLog.forget(directory);
      const restarted = new FileAgentTimelineStore(async () => directory);
      const ranges = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const part = await restarted.readProjectedSourceRanges("a", {
          epoch: page.epoch,
          id: entry.sourceSeqRangesRef!.id,
          offset,
        });
        ranges.push(...part.ranges);
        offset = part.nextOffset;
      }
      expect(ranges).toEqual(seqs.map((seq) => ({ startSeq: seq, endSeq: seq })));
      let text = "";
      offset = 0;
      while (offset !== null) {
        const part = await restarted.readProjectedPayload("a", {
          epoch: page.epoch,
          id: entry.deferredPayload!.id,
          offset,
        });
        text += part.text;
        offset = part.nextOffset;
      }
      expect(JSON.parse(text)).toEqual(rows.at(-1)!.item);
      const older = await restarted.fetchProjectedCommitted("a", {
        pagingMode: "source_ranges",
        direction: "before",
        cursor: { epoch: page.epoch, seq: page.startSeq! },
        limit: 40,
      });
      expect(older.endSeq).toBe(page.startSeq! - 1);
      const forward = await restarted.fetchProjectedCommitted("a", {
        pagingMode: "source_ranges",
        direction: "after",
        cursor: { epoch: page.epoch, seq: 0 },
        limit: 1,
        allowDeferredPayloads: true,
      });
      expect(forward.entries[0]!.sourceSeqRangesRef).toEqual(entry.sourceSeqRangesRef);
    },
  );

  it.each([
    { count: 1100, size: 16384 },
    { count: 300, size: 70000 },
  ])(
    "accepts legacy descriptors above the budget with $size-byte entries and rejects unknown ids",
    async ({ count, size }) => {
      const rows = Array.from({ length: count }, (_, index) => message(index + 1, size));
      rows[0] = message(1, 70_000);
      const { store } = await fixture(rows);
      const epoch = await store.getEpoch("a");
      const id = createHash("sha256").update(`${epoch}:1:1`).digest("hex");
      const part = await store.readProjectedPayload("a", { epoch, id, limit: 1024 });
      expect(part.totalBytes).toBe(Buffer.byteLength(JSON.stringify(rows[0]!.item)));
      expect(part.text).toBe(JSON.stringify(rows[0]!.item).slice(0, 1024));
      await expect(store.readProjectedPayload("a", { epoch, id: "f".repeat(64) })).rejects.toThrow(
        "Invalid or stale projected document descriptor",
      );
    },
  );
});
