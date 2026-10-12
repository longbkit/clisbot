import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
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
