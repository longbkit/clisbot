import { afterEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProviderSubagentStore } from "./store.js";
import { ProviderSubagentPersistence, encodedSubagentId } from "./persistence.js";
import { pendingSessionEvents } from "../session-storage/pending-event-budget.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-admission-"));
  roots.push(directory);
  const options = { resolveParentDirectory: async () => directory };
  return { directory, options, store: new ProviderSubagentStore(options) };
}
it("rejects an oversized descriptor before persistence or cache publication", async () => {
  const { directory, store, options } = await fixture();
  await store.applyCommitted("parent", "codex", { type: "upsert", id: "child", title: "original" });
  const previous = store.get("parent", "child");
  await expect(
    store.applyCommitted("parent", "codex", {
      type: "upsert",
      id: "child",
      title: "x".repeat(65536),
    }),
  ).rejects.toThrow("budget");
  expect(store.get("parent", "child")).toEqual(previous);
  const persisted = JSON.parse(
    await fs.readFile(
      path.join(directory, "subagents", encodedSubagentId("child"), "session.json"),
      "utf8",
    ),
  );
  expect(persisted.title).toBe("original");
  const reopened = new ProviderSubagentStore(options);
  await reopened.hydrate("parent");
  expect(reopened.get("parent", "child")?.title).toBe("original");
});
it("reserves current-parent metadata capacity before writing and leaves accepted descriptors readable", async () => {
  const { directory, store, options } = await fixture();
  for (let index = 0; index < 64; index += 1)
    await store.applyCommitted("parent", "codex", {
      type: "upsert",
      id: `child${index}`,
      description: "x".repeat(63 * 1024),
    });
  await expect(
    store.applyCommitted("parent", "codex", {
      type: "upsert",
      id: "overflow",
      description: "x".repeat(63 * 1024),
    }),
  ).rejects.toThrow("cache byte budget");
  expect(store.list("parent")).toHaveLength(64);
  expect(store.get("parent", "overflow")).toBeNull();
  await expect(
    fs.stat(path.join(directory, "subagents", encodedSubagentId("overflow"))),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const reopened = new ProviderSubagentStore(options);
  await reopened.hydrate("parent");
  expect(reopened.list("parent")).toHaveLength(64);
});
it("snapshots queued descriptors, publishes only after save, and releases failed admissions", async () => {
  const { store } = await fixture();
  await store.applyCommitted("parent", "codex", { type: "upsert", id: "child", title: "original" });
  const baseline = pendingSessionEvents.pendingBytes;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = ProviderSubagentPersistence.prototype.save;
  vi.spyOn(ProviderSubagentPersistence.prototype, "save").mockImplementationOnce(
    async function (this: ProviderSubagentPersistence, event) {
      enter();
      await held;
      return save.call(this, event);
    },
  );
  const event = { type: "upsert" as const, id: "child", title: "accepted" };
  const pending = store.applyCommitted("parent", "codex", event);
  event.title = "mutated after admission";
  await entered;
  expect(store.get("parent", "child")?.title).toBe("original");
  release();
  await pending;
  expect(store.get("parent", "child")?.title).toBe("accepted");
  // Read and event snapshots must not expose mutable cache entries around admission.
  store.get("parent", "child")!.description = "x".repeat(70000);
  store.list("parent")[0]!.title = "mutated list";
  store.listAll()[0]!.title = "mutated all";
  const accepted = await pending;
  if (accepted.type !== "upsert") throw new Error("Expected descriptor update");
  accepted.subagent.title = "mutated event";
  expect(store.get("parent", "child")?.title).toBe("accepted");
  expect(store.get("parent", "child")?.description).toBeNull();
  vi.spyOn(ProviderSubagentPersistence.prototype, "save").mockRejectedValueOnce(
    new Error("Injected ENOSPC"),
  );
  await expect(
    store.applyCommitted("parent", "codex", {
      type: "upsert",
      id: "child",
      title: "must not publish",
    }),
  ).rejects.toThrow("ENOSPC");
  expect(store.get("parent", "child")?.title).toBe("accepted");
  expect(pendingSessionEvents.pendingBytes).toBe(baseline);
  await store.applyCommitted("parent", "codex", {
    type: "upsert",
    id: "child",
    title: "after failure",
  });
  expect(store.get("parent", "child")?.title).toBe("after failure");
});
it("retains complete durable subagent tool output and offers its deferred document", async () => {
  const { store } = await fixture();
  await store.applyCommitted("parent", "codex", { type: "upsert", id: "child" });
  const output = "large output😀".repeat(10000);
  await store.applyCommitted("parent", "codex", {
    type: "timeline",
    id: "child",
    item: {
      type: "tool_call",
      callId: "tool",
      name: "shell",
      status: "completed",
      error: null,
      detail: { type: "shell", command: "work", output },
    },
  });
  const canonical = await store.fetchCommittedTimeline("parent", "child", { limit: 1 });
  expect(canonical.rows[0].item).toMatchObject({ detail: { output } });
  const page = await store.fetchProjectedCommittedTimeline("parent", "child", {
    pagingMode: "source_ranges",
    allowDeferredPayloads: true,
    limit: 1,
  });
  const descriptor = page!.entries[0].deferredPayload!;
  expect(descriptor.byteLength).toBeGreaterThan(65536);
  let text = "";
  let offset: number | null = 0;
  while (offset !== null) {
    const part = await store.readPayload("parent", "child", {
      epoch: page!.epoch,
      id: descriptor.id,
      offset,
    });
    text += part.text;
    offset = part.nextOffset;
  }
  expect(JSON.parse(text).detail.output).toBe(output);
});
