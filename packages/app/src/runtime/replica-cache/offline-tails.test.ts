import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { ReplicaCache, type CachedTimeline } from ".";
import { MemoryStorage } from "./testing";
import { TAIL_MAX_BYTES } from "./timeline-tail";

const SERVER_ID = "host-1";
const timestamp = new Date("2026-10-30T08:00:00.000Z");

function createCache(storage: MemoryStorage, offlineTails = true): ReplicaCache {
  const cache = new ReplicaCache(storage, {
    clearLegacyCache: async () => undefined,
    offlineTails,
  });
  cache.setHosts([SERVER_ID]);
  return cache;
}

const DAY = 24 * 60 * 60 * 1000;

function clockedCache(storage: MemoryStorage, clock: { now: number }, maxBytes?: number) {
  const cache = new ReplicaCache(storage, {
    clearLegacyCache: async () => undefined,
    offlineTails: true,
    now: () => clock.now,
    ...(maxBytes ? { maxBytes } : {}),
  });
  cache.setHosts([SERVER_ID]);
  return cache;
}

function message(seq: number, text = `message ${seq}`): StreamItem {
  return {
    kind: "assistant_message",
    id: `message-${seq}`,
    text,
    timestamp,
    timelineCursor: { epoch: "epoch-1", seq },
  };
}

function toolCall(seq: number, output: string): StreamItem {
  return {
    kind: "tool_call",
    id: `tool-${seq}`,
    timestamp,
    timelineCursor: { epoch: "epoch-1", seq },
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: `call-${seq}`,
        name: "Bash",
        status: "completed",
        error: null,
        detail: { type: "shell", command: "cat big.log", output, exitCode: 0 },
      },
    },
  };
}

function tail(items: StreamItem[]): CachedTimeline {
  const seqs = items.map((item) => item.timelineCursor?.seq ?? 0);
  return {
    agentId: "agent-1",
    items,
    range: { epoch: "epoch-1", startSeq: Math.min(...seqs), endSeq: Math.max(...seqs) },
    hasOlder: true,
  };
}

async function roundTrip(value: CachedTimeline, offlineTails = true) {
  const storage = new MemoryStorage();
  const writer = createCache(storage, offlineTails);
  writer.commitTimeline(SERVER_ID, "agent-1", value);
  await writer.flush();
  const row = [...storage.rows.values()].find((candidate) => candidate.kind === "timeline");
  const restored = await createCache(storage, offlineTails).readTimeline(SERVER_ID, "agent-1");
  return { payload: row?.payload ?? "", restored };
}

describe("offline timeline tails", () => {
  it("never persists tool output and marks the tail lossy so the open path refetches", async () => {
    const { payload, restored } = await roundTrip(
      tail([message(1), toolCall(2, "SECRET-OUTPUT ".repeat(1000))]),
    );

    expect(payload).not.toContain("SECRET-OUTPUT");
    expect(restored?.range).toBeNull();
    expect(restored?.hasOlder).toBe(false);
    expect(restored?.items.map((item) => item.id)).toEqual(["message-1", "tool-2"]);
    const tool = restored?.items[1];
    if (tool?.kind !== "tool_call" || tool.payload.source !== "agent") throw new Error("shape");
    expect(tool.payload.data.detail).toEqual({ type: "plain_text", label: "cat big.log" });
  });

  it("keeps the canonical range for a text-only tail of more than 50 items", async () => {
    const items = Array.from({ length: 120 }, (_, index) => message(index + 1));

    const { restored } = await roundTrip(tail(items));

    expect(restored?.items).toHaveLength(120);
    expect(restored?.range).toEqual({ epoch: "epoch-1", startSeq: 1, endSeq: 120 });
  });

  it("caps one tail at 256 KB, keeping the newest items, and drops its coverage", async () => {
    const items = Array.from({ length: 40 }, (_, index) => message(index + 1, "z".repeat(10_000)));

    const { payload, restored } = await roundTrip(tail(items));

    expect(new TextEncoder().encode(payload).byteLength).toBeLessThanOrEqual(TAIL_MAX_BYTES);
    expect(restored?.items.at(-1)?.id).toBe("message-40");
    expect(restored?.items.length).toBeLessThan(40);
    expect(restored?.range).toBeNull();
  });

  it("records when the session was opened on its tail row", async () => {
    const storage = new MemoryStorage();
    const clock = { now: DAY * 100 };
    const cache = clockedCache(storage, clock);
    await cache.readTimeline(SERVER_ID, "agent-1");
    clock.now += 60_000;
    cache.commitTimeline(SERVER_ID, "agent-1", tail([message(1)]));
    await cache.flush();

    expect(storage.rows.get(`${SERVER_ID}:timeline:agent-1`)?.openedAt).toBe(DAY * 100);
  });

  it("stops saving a tail whose session was last opened more than 7 days ago", async () => {
    const storage = new MemoryStorage();
    const clock = { now: DAY * 100 };
    const cache = clockedCache(storage, clock);
    await cache.readTimeline(SERVER_ID, "agent-1");
    clock.now += 8 * DAY;
    cache.commitTimeline(SERVER_ID, "agent-1", tail([message(1)]));
    await cache.flush();

    expect(storage.rows.has(`${SERVER_ID}:timeline:agent-1`)).toBe(false);
  });

  it("drops tails not opened for 30 days when the store is first used", async () => {
    const storage = new MemoryStorage();
    storage.rows.set(`${SERVER_ID}:timeline:old`, {
      serverId: SERVER_ID,
      kind: "timeline",
      id: "old",
      payload: "{}",
      openedAt: DAY * 60,
    });
    storage.rows.set(`${SERVER_ID}:agent:old`, {
      serverId: SERVER_ID,
      kind: "agent",
      id: "old",
      payload: "{}",
    });
    const cache = clockedCache(storage, { now: DAY * 100 });

    await cache.readTimeline(SERVER_ID, "another-session");

    expect([...storage.rows.keys()]).toEqual([`${SERVER_ID}:agent:old`]);
  });

  it("evicts the least recently opened tails, never metadata or another Host", async () => {
    const storage = new MemoryStorage();
    const clock = { now: DAY * 100 };
    const cache = clockedCache(storage, clock, 40_000);
    cache.setHosts([SERVER_ID, "host-2"]);
    storage.rows.set("host-2:agent:a", {
      serverId: "host-2",
      kind: "agent",
      id: "a",
      payload: "m".repeat(5_000),
    });
    for (const agentId of ["oldest", "middle", "newest"]) {
      await cache.readTimeline(SERVER_ID, agentId);
      cache.commitTimeline(SERVER_ID, agentId, {
        ...tail([message(1, "t".repeat(15_000))]),
        agentId,
      });
      await cache.flush();
      clock.now += 1_000;
    }

    expect([...storage.rows.keys()].sort()).toEqual([
      "host-1:timeline:middle",
      "host-1:timeline:newest",
      "host-2:agent:a",
    ]);
  });

  it("keeps session metadata even when it alone is over budget", async () => {
    const storage = new MemoryStorage();
    storage.rows.set(`${SERVER_ID}:agent:big`, {
      serverId: SERVER_ID,
      kind: "agent",
      id: "big",
      payload: "m".repeat(2_000),
    });
    const cache = clockedCache(storage, { now: DAY * 100 }, 1_000);
    await cache.readTimeline(SERVER_ID, "agent-1");
    cache.commitTimeline(SERVER_ID, "agent-1", tail([message(1)]));
    await cache.flush();

    expect([...storage.rows.keys()]).toEqual([`${SERVER_ID}:agent:big`]);
  });

  it("reports the bytes it holds and clears one source without touching another", async () => {
    const storage = new MemoryStorage();
    const cache = createCache(storage);
    cache.setHosts([SERVER_ID, "host-2"]);
    cache.commitTimeline(SERVER_ID, "agent-1", tail([message(1)]));
    cache.commitTimeline("host-2", "agent-1", tail([message(1)]));
    await cache.flush();
    const both = await cache.usedBytes();

    await cache.clearSource(SERVER_ID);

    expect([...storage.rows.keys()]).toEqual(["host-2:timeline:agent-1"]);
    expect(await cache.usedBytes()).toBe(both / 2);
    expect(await cache.readTimeline(SERVER_ID, "agent-1")).toBeUndefined();
  });

  it("clears everything and rebuilds a cleared directory only from a full baseline", async () => {
    const storage = new MemoryStorage();
    const cache = createCache(storage);
    cache.commitTimeline(SERVER_ID, "agent-1", tail([message(1)]));
    await cache.flush();

    await cache.clearAll();
    expect(storage.rows.size).toBe(0);
    expect(await cache.usedBytes()).toBe(0);

    cache.commitDirectoryMutations(SERVER_ID, [], { agents: { generation: "g", afterSeq: 4 } });
    await cache.flush();
    expect(storage.rows.size).toBe(0);
  });

  it("keeps the 50-item tail when the offline cache flag is off", async () => {
    const items = Array.from({ length: 120 }, (_, index) => message(index + 1));

    const { restored } = await roundTrip(tail(items), false);

    expect(restored?.items).toHaveLength(50);
    expect(restored?.range).toBeNull();
  });
});
