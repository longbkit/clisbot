import { afterEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProviderSubagentStore } from "./store.js";
import { deleteSessionDirectory } from "../../file-upload/session-files.js";
import { encodedSubagentId } from "./persistence.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
it("restores descriptor and paged timeline with opaque ID and no inferred running process", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "provider-subagent-storage-"));
  roots.push(directory);
  const options = { resolveParentDirectory: async () => directory };
  const writer = new ProviderSubagentStore(options);
  const id = "../opaque/provider:subagent";
  await writer.applyCommitted(
    "parent",
    "codex",
    { type: "upsert", id, title: "Observed child", status: "running" },
    { runtimeAvailable: true },
  );
  const first = await writer.applyCommitted("parent", "codex", {
    type: "timeline",
    id,
    item: { type: "assistant_message", text: "saved output" },
  });
  const reader = new ProviderSubagentStore({ ...options, writable: false });
  await reader.hydrate("parent");
  expect(reader.list("parent")[0]).toMatchObject({
    id,
    title: "Observed child",
    status: "running",
    runtimeAvailable: false,
  });
  const page = await reader.fetchCommittedTimeline("parent", id, { limit: 40 });
  expect(page.rows[0].item).toEqual({
    type: "assistant_message",
    text: "saved output",
  });
  expect(first.type === "timeline" && first.epoch).toBe(page.epoch);
  expect(await fs.readdir(path.join(directory, "subagents"))).toContain(encodedSubagentId(id));
  const resumed = new ProviderSubagentStore(options);
  const next = await resumed.applyCommitted("parent", "codex", {
    type: "timeline",
    id,
    item: { type: "assistant_message", text: "after restart" },
  });
  expect(next.type === "timeline" && next.row.seq).toBe(2);
});

it("keeps removal visibility after restart, retains history, and reactivates the same provider ID", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "provider-subagent-removal-"));
  roots.push(directory);
  const options = { resolveParentDirectory: async () => directory };
  const first = new ProviderSubagentStore(options);
  await first.applyCommitted("parent", "codex", { type: "upsert", id: "child", title: "original" });
  await first.applyCommitted("parent", "codex", {
    type: "timeline",
    id: "child",
    item: { type: "assistant_message", text: "retained history" },
  });
  await first.applyCommitted("parent", "codex", { type: "remove", id: "child" });
  const reopened = new ProviderSubagentStore(options);
  await reopened.hydrate("parent");
  expect(reopened.list("parent")).toEqual([]);
  expect((await reopened.fetchCommittedTimeline("parent", "child")).rows[0].item).toMatchObject({
    text: "retained history",
  });
  await reopened.applyCommitted("parent", "codex", {
    type: "upsert",
    id: "child",
    title: "returned",
  });
  const final = new ProviderSubagentStore(options);
  await final.hydrate("parent");
  expect(final.list("parent")).toMatchObject([
    { id: "child", title: "returned", runtimeAvailable: false },
  ]);
  const appended = await final.applyCommitted("parent", "codex", {
    type: "timeline",
    id: "child",
    item: { type: "assistant_message", text: "new history" },
  });
  expect(appended.type === "timeline" && appended.row.seq).toBe(2);
  const page = await final.fetchProjectedCommittedTimeline("parent", "child", {
    pagingMode: "source_ranges",
    limit: 1,
  });
  expect(page?.pagingMode).toBe("source_ranges");
  expect(page?.endSeq).toBe(2);
});

it("does not recreate deleted parent folders from a stale subagent resolver", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "provider-subagent-delete-"));
  roots.push(home);
  const directory = path.join(home, "parent");
  const options = { resolveParentDirectory: async () => directory };
  const writer = new ProviderSubagentStore(options);
  await writer.applyCommitted("parent", "codex", { type: "upsert", id: "child" });
  await deleteSessionDirectory(directory);
  const stale = new ProviderSubagentStore(options);
  await expect(
    stale.applyCommitted("parent", "codex", { type: "upsert", id: "new-child" }),
  ).rejects.toThrow("deleted");
  await expect(fs.stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
});
