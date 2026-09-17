import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";
import { SessionEventLog } from "./session-event-log.js";
import { resolveSessionLogWriteConcurrency } from "./session-storage-io.js";
import {
  STORE_ADMISSION_LIMITS,
  SessionStorageOverloadError,
  storeOperationUsage,
} from "./store-admission.js";

const roots: string[] = [];
const gates: Gate[] = [];
afterEach(async () => {
  // A failed assertion must not leave a held write occupying the process-wide write slots.
  for (const held of gates.splice(0)) held.open();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "file-agent-timeline-store-"));
  roots.push(root);
  return root;
}

function row(seq: number, text = `row ${seq}`): AgentTimelineRow {
  return {
    seq,
    timestamp: "2026-09-17T00:00:00.000Z",
    item: { type: "assistant_message", messageId: "reply", text },
  };
}

interface Gate {
  open: () => void;
  wait: Promise<void>;
}
function gate(): Gate {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  const created = { open, wait };
  gates.push(created);
  return created;
}

/** Wraps every `events.jsonl` handle so a test can count or hold appends and fsyncs. */
function observeLogHandles(hooks: {
  beforeWritev?: () => Promise<void>;
  beforeSync?: () => Promise<void>;
  afterSync?: () => void;
}): { writevs: () => number; syncs: () => number } {
  let writevs = 0;
  let syncs = 0;
  const open = fs.open.bind(fs);
  vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args);
    if (!String(args[0]).endsWith("events.jsonl")) return handle;
    const writev = handle.writev.bind(handle);
    handle.writev = (async (...writeArgs: Parameters<typeof handle.writev>) => {
      writevs += 1;
      await hooks.beforeWritev?.();
      return writev(...writeArgs);
    }) as typeof handle.writev;
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      syncs += 1;
      await hooks.beforeSync?.();
      await sync();
      hooks.afterSync?.();
    };
    return handle;
  });
  return { writevs: () => writevs, syncs: () => syncs };
}

describe("admission", () => {
  it("refuses a stalled agent's writes without refusing another agent or its own reads", async () => {
    const root = await temporaryRoot();
    const stalled = gate();
    const store = new FileAgentTimelineStore(async (agentId) => {
      if (agentId === "stalled") await stalled.wait;
      return path.join(root, agentId);
    });
    const writes: Promise<void>[] = [];
    for (let seq = 1; seq <= STORE_ADMISSION_LIMITS.agentWriteOperations; seq += 1)
      writes.push(store.bulkInsert("stalled", [row(seq)]));
    await expect(store.bulkInsert("stalled", [row(99_999)])).rejects.toBeInstanceOf(
      SessionStorageOverloadError,
    );
    await store.bulkInsert("healthy", [row(1)]);
    expect(await store.getLatestCommittedSeq("healthy")).toBe(1);
    const read = store.getLatestCommittedSeq("stalled");
    stalled.open();
    await Promise.all(writes);
    expect(await read).toBe(STORE_ADMISSION_LIMITS.agentWriteOperations);
    expect(storeOperationUsage("write")).toEqual({ operations: 0, bytes: 0 });
  });
});

describe("group commit", () => {
  it("commits rows queued behind an in-flight append with one append and one fsync", async () => {
    const root = await temporaryRoot();
    const first = gate();
    const acknowledged: string[] = [];
    let heldFirstSync = false;
    const handles = observeLogHandles({
      beforeSync: async () => {
        if (heldFirstSync) return;
        heldFirstSync = true;
        await first.wait;
      },
      afterSync: () => acknowledged.push("fsync"),
    });
    const store = new FileAgentTimelineStore(async () => root);
    const acknowledge = (seq: number) => () => {
      acknowledged.push(`ack ${seq}`);
    };
    const writes = [store.bulkInsert("agent", [row(1)]).then(acknowledge(1))];
    await vi.waitFor(() => expect(heldFirstSync).toBe(true));
    for (let seq = 2; seq <= 100; seq += 1)
      writes.push(store.bulkInsert("agent", [row(seq)]).then(acknowledge(seq)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(acknowledged).toEqual([]);
    first.open();
    await Promise.all(writes);
    expect(handles.writevs()).toBe(2);
    expect(handles.syncs()).toBe(2);
    // Every acknowledgement follows the fsync that covered its row.
    expect(acknowledged.slice(0, 2)).toEqual(["fsync", "ack 1"]);
    expect(acknowledged[2]).toBe("fsync");
    const page = await store.fetchCommitted("agent", { limit: 0 });
    expect(page.rows.map((committed) => committed.seq)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
  });

  it("rejects every row of a failed batch and acknowledges none of them", async () => {
    const root = await temporaryRoot();
    const first = gate();
    let appends = 0;
    observeLogHandles({
      beforeWritev: async () => {
        appends += 1;
        if (appends === 1) await first.wait;
        else throw Object.assign(new Error("injected disk full"), { code: "ENOSPC" });
      },
    });
    const store = new FileAgentTimelineStore(async () => root);
    const committed = store.bulkInsert("agent", [row(1)]);
    await vi.waitFor(() => expect(appends).toBe(1));
    const failed = Array.from({ length: 10 }, (_, index) =>
      store.bulkInsert("agent", [row(index + 2)]),
    );
    first.open();
    await committed;
    for (const write of failed) await expect(write).rejects.toThrow("injected disk full");
    vi.restoreAllMocks();
    expect(await store.getLatestCommittedSeq("agent")).toBe(1);
    SessionEventLog.forgetAll();
    expect(await new FileAgentTimelineStore(async () => root).getLatestCommittedSeq("agent")).toBe(
      1,
    );
  });

  it("keeps order and the admitting operation when a rewrite joins its row's batch", async () => {
    const root = await temporaryRoot();
    const first = gate();
    let armed = false;
    let held = false;
    observeLogHandles({
      beforeSync: async () => {
        if (!armed || held) return;
        held = true;
        await first.wait;
      },
    });
    const store = new FileAgentTimelineStore(async () => root);
    const sender = { kind: "user" as const, id: "sender" };
    await store.writeMessageSubmission("agent", {
      id: "prompt",
      digest: "prompt",
      timestamp: "2026-09-17T00:00:00.000Z",
      identity: { actor: sender },
      status: "pending",
    });
    const prompt = (text: string): AgentTimelineRow => ({
      seq: 2,
      timestamp: "2026-09-17T00:00:00.000Z",
      item: { type: "user_message", text, clientMessageId: "prompt" },
    });
    armed = true;
    const initial = store.bulkInsert("agent", [row(1)]);
    await vi.waitFor(() => expect(held).toBe(true));
    const batched = [
      store.bulkInsert("agent", [prompt("draft")]),
      store.bulkInsert("agent", [row(3)]),
      store.updateCommittedRow("agent", prompt("final")),
    ];
    first.open();
    await Promise.all([initial, ...batched]);
    const rows = (await store.fetchCommitted("agent", { limit: 0 })).rows;
    expect(rows.map((committed) => [committed.seq, committed.item])).toEqual([
      [1, row(1).item],
      [2, prompt("final").item],
      [3, row(3).item],
    ]);
    SessionEventLog.forgetAll();
    const restarted = new FileAgentTimelineStore(async () => root);
    expect((await restarted.fetchCommitted("agent", { limit: 0 })).rows).toEqual(rows);
    expect((await restarted.recoverAuthorship("agent")).summary.lastMessageBy).toEqual(sender);
  });
});

describe("session log write concurrency", () => {
  it("runs no more stalled fsyncs at once than the write limit, across agents", async () => {
    const root = await temporaryRoot();
    const disk = gate();
    let inFlight = 0;
    let peak = 0;
    observeLogHandles({
      beforeSync: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await disk.wait;
        inFlight -= 1;
      },
    });
    const limit = 2;
    // The limit is fixed when the module loads, so load a fresh copy under the test's env.
    vi.stubEnv("PASEO_SESSION_LOG_WRITE_CONCURRENCY", String(limit));
    vi.resetModules();
    const fresh = await import("./file-agent-timeline-store.js");
    vi.unstubAllEnvs();
    const store = new fresh.FileAgentTimelineStore(async (agentId) => path.join(root, agentId));
    const writes = Array.from({ length: limit + 3 }, (_, index) =>
      store.bulkInsert(`agent-${index}`, [row(1)]),
    );
    await vi.waitFor(() => expect(inFlight).toBe(limit));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(peak).toBe(limit);
    disk.open();
    await Promise.all(writes);
  });

  it("derives the limit from the threadpool and honours an explicit override", () => {
    expect(resolveSessionLogWriteConcurrency({})).toBe(Number.POSITIVE_INFINITY);
    expect(resolveSessionLogWriteConcurrency({ UV_THREADPOOL_SIZE: "4" })).toBe(4);
    expect(resolveSessionLogWriteConcurrency({ UV_THREADPOOL_SIZE: "16" })).toBe(8);
    expect(
      resolveSessionLogWriteConcurrency({
        UV_THREADPOOL_SIZE: "16",
        PASEO_SESSION_LOG_WRITE_CONCURRENCY: "3",
      }),
    ).toBe(3);
  });
});

describe("index checkpoints", () => {
  it("does not rewrite a large index every few dozen appends, and a restart still reads them", async () => {
    const root = await temporaryRoot();
    const store = new FileAgentTimelineStore(async () => root);
    const history = Array.from({ length: 4000 }, (_, index) => row(index + 1));
    for (let index = 0; index < history.length; index += 256)
      await store.bulkInsert("agent", history.slice(index, index + 256));
    await store.flush();
    const rename = fs.rename.bind(fs);
    let checkpoints = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith("events.index.json")) checkpoints += 1;
      return rename(from, to);
    });
    for (let seq = 4001; seq <= 4200; seq += 1) await store.bulkInsert("agent", [row(seq)]);
    expect(checkpoints).toBe(0);
    vi.restoreAllMocks();
    SessionEventLog.forgetAll();
    const restarted = new FileAgentTimelineStore(async () => root);
    expect(await restarted.getLatestCommittedSeq("agent")).toBe(4200);
    const tail = await restarted.fetchCommitted("agent", { limit: 3 });
    expect(tail.rows).toEqual([row(4198), row(4199), row(4200)]);
  });

  it("loads an index written without seq ranges and one whose ranges an older daemon left behind", async () => {
    const root = await temporaryRoot();
    const store = new FileAgentTimelineStore(async () => root);
    await store.bulkInsert("agent", [row(1), row(2), row(3)]);
    await store.flush();
    const indexPath = path.join(root, "events.index.json");
    const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
    expect(index.seqRanges.kinds.timeline).toEqual({ minSeq: 1, maxSeq: 3 });

    delete index.seqRanges;
    await fs.writeFile(indexPath, JSON.stringify(index));
    SessionEventLog.forgetAll();
    expect(await new FileAgentTimelineStore(async () => root).getLatestCommittedSeq("agent")).toBe(
      3,
    );

    // An older daemon appends and checkpoints, carrying the unknown field forward unchanged.
    await new FileAgentTimelineStore(async () => root).bulkInsert("agent", [row(4)]);
    await SessionEventLog.flushAll();
    const advanced = JSON.parse(await fs.readFile(indexPath, "utf8"));
    advanced.seqRanges = { scannedBytes: index.scannedBytes, kinds: { timeline: index.seqRanges } };
    advanced.seqRanges.kinds.timeline = { minSeq: 1, maxSeq: 3 };
    await fs.writeFile(indexPath, JSON.stringify(advanced));
    SessionEventLog.forgetAll();
    expect(await new FileAgentTimelineStore(async () => root).getLatestCommittedSeq("agent")).toBe(
      4,
    );
  });
});
