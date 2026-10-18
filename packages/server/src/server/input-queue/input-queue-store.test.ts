import { describe, expect, it } from "vitest";
import { InputQueueStore, type QueueSnapshot, type QueueStorage } from "./input-queue-store.js";

class MemoryStorage implements QueueStorage {
  value: unknown | null = null;
  fail = false;
  async read() {
    return structuredClone(this.value);
  }
  async write(value: QueueSnapshot) {
    if (this.fail) throw new Error("disk full");
    this.value = structuredClone(value);
  }
}
const item = (id: string) => ({
  id,
  createdAt: "2026-10-18T00:00:00Z",
  senderId: "owner",
  payload: { text: id },
});

describe("Host queue snapshots", () => {
  it("survives restart and preserves the surviving position on edit", async () => {
    const disk = new MemoryStorage();
    const queue = new InputQueueStore(disk);
    await queue.enqueue(item("a"));
    await queue.enqueue(item("b"));
    await queue.claim();
    await queue.settle("a", "handed_off");
    const reopened = new InputQueueStore(disk);
    const before = await reopened.read();
    await reopened.mutate({
      id: "b",
      revision: before.revision,
      action: "update",
      payload: { text: "edited" },
    });
    expect((await reopened.read()).items.map((i) => [i.id, i.payload])).toEqual([
      ["b", { text: "edited" }],
    ]);
  });
  it("keeps the old snapshot if commit fails and accepts a retry", async () => {
    const disk = new MemoryStorage();
    const queue = new InputQueueStore(disk);
    await queue.enqueue(item("a"));
    disk.fail = true;
    await expect(queue.enqueue(item("b"))).rejects.toThrow("disk full");
    expect((await queue.read()).items.map((i) => i.id)).toEqual(["a"]);
    disk.fail = false;
    await queue.enqueue(item("b"));
    expect((await new InputQueueStore(disk).read()).revision).toBe(2);
  });
  it("rejects concurrent device edits and stale saves without resurrection", async () => {
    const queue = new InputQueueStore(new MemoryStorage());
    const before = await queue.enqueue(item("a"));
    const results = await Promise.allSettled([
      queue.mutate({ id: "a", revision: before.revision, action: "update", payload: "first" }),
      queue.mutate({ id: "a", revision: before.revision, action: "delete" }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    await queue.claim();
    const after = await queue.read();
    await expect(
      queue.mutate({ id: "a", revision: after.revision, action: "update", payload: "late" }),
    ).rejects.toThrow("started");
    await queue.settle("a", "handed_off");
    await expect(
      queue.mutate({
        id: "a",
        revision: (await queue.read()).revision,
        action: "update",
        payload: "late",
      }),
    ).rejects.toThrow("deleted");
    expect((await queue.read()).items).toEqual([]);
  });
  it("moves the same ID atomically and never exposes an editing lock", async () => {
    const queue = new InputQueueStore(new MemoryStorage());
    await queue.enqueue(item("a"));
    const before = await queue.enqueue(item("b"));
    await queue.mutate({
      id: "a",
      revision: before.revision,
      action: "move_to_end",
      payload: "new",
    });
    expect((await queue.read()).items.map((i) => i.id)).toEqual(["b", "a"]);
    expect((await queue.claim())?.id).toBe("b");
  });
  it("does not replay a crash-left claim without durable proof", async () => {
    const disk = new MemoryStorage();
    const queue = new InputQueueStore(disk);
    await queue.enqueue(item("a"));
    await queue.enqueue(item("b"));
    await queue.claim();
    const reopened = new InputQueueStore(disk);
    await reopened.recover(async () => false);
    expect((await reopened.read()).items[0].state).toBe("needs_review");
    expect(await reopened.claim()).toBeNull();
  });
  it("removes confirmed handoff on restart, without waiting for model completion", async () => {
    const disk = new MemoryStorage();
    const queue = new InputQueueStore(disk);
    await queue.enqueue(item("a"));
    await queue.claim();
    const reopened = new InputQueueStore(disk);
    await reopened.recover(async () => true);
    expect((await reopened.read()).items).toEqual([]);
    expect((await reopened.read()).revision).toBe(3);
  });
  it("deduplicates a lost enqueue ack but refuses changed content", async () => {
    const queue = new InputQueueStore(new MemoryStorage());
    await queue.enqueue(item("a"));
    expect((await queue.enqueue(item("a"))).revision).toBe(1);
    await expect(queue.enqueue({ ...item("a"), payload: "different" })).rejects.toThrow(
      "conflicts",
    );
  });
  it("refuses overload and corrupted snapshots without evicting accepted input", async () => {
    const disk = new MemoryStorage();
    const queue = new InputQueueStore(disk);
    for (let i = 0; i < 32; i++) await queue.enqueue(item(String(i)));
    await expect(queue.enqueue(item("overflow"))).rejects.toThrow("full");
    expect((await queue.read()).items).toHaveLength(32);
    disk.value = { version: 99, items: [] };
    await expect(new InputQueueStore(disk).read()).rejects.toThrow();
  });
});

describe("claim and mutation races share one writer", () => {
  it("claim winning rejects a concurrent Save without changing runnable content", async () => {
    const queue = new InputQueueStore(new MemoryStorage());
    const before = await queue.enqueue(item("a"));
    const [claim, edit] = await Promise.allSettled([
      queue.claim(),
      queue.mutate({ id: "a", revision: before.revision, action: "update", payload: "late" }),
    ]);
    expect(claim.status).toBe("fulfilled");
    expect(edit.status).toBe("rejected");
    expect((await queue.read()).items[0]).toMatchObject({
      state: "sending",
      payload: { text: "a" },
    });
  });
  it("Save winning gives the worker the changed payload under the same identity", async () => {
    const queue = new InputQueueStore(new MemoryStorage());
    const before = await queue.enqueue(item("a"));
    const [saved, claimed] = await Promise.all([
      queue.mutate({ id: "a", revision: before.revision, action: "update", payload: "new" }),
      queue.claim(),
    ]);
    expect(saved.revision).toBe(2);
    expect(claimed).toMatchObject({ id: "a", payload: "new", state: "sending" });
  });
  it("Delete winning leaves nothing for a concurrent claim", async () => {
    const queue = new InputQueueStore(new MemoryStorage());
    const before = await queue.enqueue(item("a"));
    const [, claimed] = await Promise.all([
      queue.mutate({ id: "a", revision: before.revision, action: "delete" }),
      queue.claim(),
    ]);
    expect(claimed).toBeNull();
    expect((await queue.read()).items).toEqual([]);
  });
});
