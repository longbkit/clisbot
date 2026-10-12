import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QuickStartInput } from "@clisbot/protocol/quick-starts/types";
import { QuickStartStore, type QuickStartAuthority } from "./store.js";
const id = "qs_0000000000000001";
const input: QuickStartInput = {
  name: "Fix bug",
  visibility: "personal",
  target: {
    kind: "project",
    projectId: "p1",
    workspace: { kind: "worktree", base: { kind: "ref", refName: "refs/remotes/origin/main" } },
  },
  startingPrompt: "Investigate, fix and test:",
  agent: {
    kind: "configured",
    config: { provider: "codex", model: "model", thinkingOptionId: "high", modeId: "safe" },
  },
};
function user(subjectId: string, canUse = true): QuickStartAuthority {
  return {
    owner: { kind: "hubUser", hubIdentity: "hub1", organizationId: "org1", subjectId },
    administrator: false,
    canUse: async () => canUse,
  };
}
describe("daemon quick starts", () => {
  let dir: string;
  let store: QuickStartStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "quick-starts-"));
    store = new QuickStartStore(join(dir, "catalog.json"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it("persists worktree and all agent controls across restart, isolated by owner", async () => {
    await store.save(user("a"), id, 0, input);
    const restarted = new QuickStartStore(join(dir, "catalog.json"));
    expect((await restarted.list(user("a"))).items[0]).toMatchObject({
      ...input,
      id,
      revision: 1,
      canEdit: true,
    });
    expect((await restarted.list(user("b"))).items).toEqual([]);
  });
  it("lets creators publish while recipients pin independently and cannot edit", async () => {
    await store.save(user("a"), id, 0, { ...input, visibility: "host" });
    expect((await store.list(user("b"))).items[0]).toMatchObject({
      id,
      canEdit: false,
      available: true,
    });
    await store.setPins(user("b"), [id], 0);
    expect((await store.list(user("b"))).preferences.pinnedIds).toEqual([id]);
    expect((await store.list(user("a"))).preferences.pinnedIds).toEqual([]);
    await expect(store.save(user("b"), id, 1, input)).rejects.toThrow("Only the creator");
    await expect(store.remove(user("b"), id, 1)).rejects.toThrow("not found");
    expect((await store.list(user("b", false))).items).toEqual([]);
  });
  it("removes other users' pins when sharing stops without removing the owner's pin", async () => {
    await store.save(user("a"), id, 0, { ...input, visibility: "host" });
    await store.setPins(user("a"), [id], 0);
    await store.setPins(user("b"), [id], 0);
    await store.save(user("a"), id, 1, input);
    expect((await store.list(user("b"))).preferences).toMatchObject({ pinnedIds: [], revision: 2 });
    expect((await store.list(user("a"))).preferences.pinnedIds).toEqual([id]);
  });
  it("rejects stale edits and concurrent pin writes instead of losing changes", async () => {
    await store.save(user("a"), id, 0, input);
    await store.save(user("a"), id, 1, { ...input, name: "New name" });
    await expect(store.save(user("a"), id, 1, input)).rejects.toThrow("another device");
    const writes = await Promise.allSettled([
      store.setPins(user("a"), [id], 0),
      store.setPins(user("a"), [], 0),
    ]);
    expect(writes.map((w) => w.status)).toEqual(["fulfilled", "rejected"]);
    expect((await store.list(user("a"))).preferences.pinnedIds).toEqual([id]);
  });
  it("retains an unavailable personal template for recovery and permits owner deletion", async () => {
    await store.save(user("a"), id, 0, input);
    expect((await store.list(user("a", false))).items[0]).toMatchObject({ id, available: false });
    await expect(
      store.save(user("a", false), id, 1, { ...input, visibility: "host" }),
    ).rejects.toThrow("unavailable");
    await store.remove(user("a", false), id, 1);
    expect((await store.list(user("a"))).items).toEqual([]);
  });
});
