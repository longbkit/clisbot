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

  it("keeps the 50-item tail when the offline cache flag is off", async () => {
    const items = Array.from({ length: 120 }, (_, index) => message(index + 1));

    const { restored } = await roundTrip(tail(items), false);

    expect(restored?.items).toHaveLength(50);
    expect(restored?.range).toBeNull();
  });
});
