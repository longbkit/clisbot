import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";
import { AgentStorage } from "../agent-storage.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import type {
  AgentPermissionResponseRecord,
  SessionActor,
} from "@getpaseo/protocol/session-authorship";

const directories: string[] = [];
const timestamp = "2026-09-11T00:00:00.000Z";
const actor = (id: string): SessionActor => ({ kind: "user", id });
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "session-summary-"));
  directories.push(directory);
  return { directory, store: new FileAgentTimelineStore(async () => directory) };
}
async function admit(
  store: FileAgentTimelineStore,
  id: string,
  sender?: SessionActor,
  receivedAt = timestamp,
) {
  await store.writeMessageSubmission("agent", {
    id,
    digest: id,
    timestamp: receivedAt,
    identity: { actor: sender },
    status: "pending",
  });
}
async function commit(store: FileAgentTimelineStore, id: string, sender?: SessionActor) {
  return store.appendCommitted("agent", {
    type: "user_message",
    text: id,
    clientMessageId: id,
    sender,
  });
}
function permission(
  id: string,
  status: AgentPermissionResponseRecord["status"],
): AgentPermissionResponseRecord {
  return {
    id,
    status,
    timestamp,
    respondedBy: actor(id),
    request: { id, kind: "tool", provider: "codex", name: "tool" },
    response: { behavior: "allow" },
  };
}
it("orders equal-time interactions by original admission, not delayed permission acknowledgement", async () => {
  const { directory, store } = await fixture();
  await admit(store, "A", actor("A"));
  await store.appendPermissionResponse("agent", permission("C", "pending"));
  await admit(store, "B", actor("B"));
  await commit(store, "A", actor("A"));
  await commit(store, "B", actor("B"));
  await store.appendPermissionResponse("agent", permission("C", "applied"));
  const restarted = new FileAgentTimelineStore(async () => directory);
  const summary = (await restarted.recoverAuthorship("agent")).summary;
  expect(summary.lastInteractionBy).toEqual(actor("B"));
  expect(summary.lastMessageBy).toEqual(actor("B"));
  expect(summary.participantActors).toEqual(
    expect.arrayContaining([actor("A"), actor("B"), actor("C")]),
  );
  await restarted.appendPermissionResponse("agent", permission("D", "pending"));
  await restarted.appendPermissionResponse("agent", permission("D", "applied"));
  expect((await restarted.recoverAuthorship("agent")).summary).toMatchObject({
    lastInteractionBy: actor("D"),
    lastMessageBy: actor("B"),
  });
});
it("clears unknown latest authors and ignores unadmitted provider imports", async () => {
  const { store } = await fixture();
  await admit(store, "A", actor("A"));
  await commit(store, "A", actor("A"));
  await admit(store, "unknown", undefined, "2026-09-11T00:00:01.000Z");
  await commit(store, "unknown");
  await commit(store, "provider-import", actor("invented"));
  const summary = (await store.recoverAuthorship("agent")).summary;
  expect(summary.lastInteractionAt).toBe("2026-09-11T00:00:01.000Z");
  expect(summary.lastInteractionBy).toBeUndefined();
  expect(summary.lastMessageBy).toBeUndefined();
  expect(summary.participantActors).toEqual([actor("A")]);
});
it("recovers canonical progress after an injected derived-checkpoint rename failure", async () => {
  const { directory, store } = await fixture();
  await admit(store, "A", actor("A"));
  await commit(store, "A", actor("A"));
  await admit(store, "B", actor("B"));
  await commit(store, "B", actor("B"));
  const rename = fs.rename.bind(fs);
  const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
    if (String(to).endsWith("events.index.json"))
      throw Object.assign(new Error("injected ENOSPC"), { code: "ENOSPC" });
    return rename(from, to);
  });
  await expect(store.flush()).rejects.toThrow("ENOSPC");
  spy.mockRestore();
  const restarted = new FileAgentTimelineStore(async () => directory);
  expect((await restarted.recoverAuthorship("agent")).summary.lastInteractionBy).toEqual(
    actor("B"),
  );
  expect(await restarted.getLatestCommittedSeq("agent")).toBe(2);
});
it("retains original operation positions on replacement and excludes removed history", async () => {
  const { store } = await fixture();
  await admit(store, "A", actor("A"));
  const first = await commit(store, "A", actor("A"));
  await admit(store, "B", actor("B"));
  await commit(store, "B", actor("B"));
  await store.replaceCommitted("agent", [
    first,
    {
      seq: 2,
      timestamp: "2099-01-01T00:00:00.000Z",
      item: { type: "user_message", text: "import" },
    },
  ]);
  expect((await store.recoverAuthorship("agent")).summary).toMatchObject({
    lastInteractionBy: actor("A"),
    lastInteractionAt: timestamp,
    participantActors: [actor("A")],
  });
});
it("retries summary delivery after observer failure and protects it from stale record snapshots", async () => {
  const { directory, store } = await fixture();
  const storage = new AgentStorage(path.join(directory, "records"), createTestLogger());
  await storage.upsert({
    id: "agent",
    provider: "codex",
    cwd: "/work",
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: actor("creator"),
  });
  const stale = (await storage.get("agent"))!;
  store.setAuthorshipObserver(async () => {
    throw new Error("observer interrupted");
  });
  await admit(store, "A", actor("A"));
  await expect(commit(store, "A", actor("A"))).rejects.toThrow("observer interrupted");
  const restarted = new FileAgentTimelineStore(async () => directory);
  restarted.setAuthorshipObserver(async (id, summary) => {
    await storage.applyAuthorship(id, summary);
  });
  await restarted.recoverAuthorship("agent");
  await storage.upsert({ ...stale, title: "stale snapshot update" });
  const recovered = await new AgentStorage(path.join(directory, "records"), createTestLogger()).get(
    "agent",
  );
  expect(recovered).toMatchObject({
    createdBy: actor("creator"),
    lastInteractionBy: actor("A"),
    title: "stale snapshot update",
  });
});

it("detects a restored valid summary checkpoint across a canonical rewrite and mixed append", async () => {
  const { directory, store } = await fixture();
  await admit(store, "A", actor("A"));
  const first = await commit(store, "A", actor("A"));
  await store.flush();
  const checkpoint = await fs.readFile(path.join(directory, "events.index.json"));
  await admit(store, "B", actor("B"));
  await store.bulkInsert("agent", [
    { ...first, item: { type: "assistant_message", text: "provider correction" } },
    {
      seq: 2,
      timestamp,
      item: { type: "user_message", text: "B", clientMessageId: "B", sender: actor("B") },
    },
  ]);
  await store.flush();
  await fs.writeFile(path.join(directory, "events.index.json"), checkpoint);
  const restarted = new FileAgentTimelineStore(async () => directory);
  expect((await restarted.recoverAuthorship("agent")).summary.participantActors).toEqual([
    actor("B"),
  ]);
});

it("pages recent permission history and resolves late status changes without duplicate page records", async () => {
  const { store, directory } = await fixture();
  await store.appendPermissionResponse("agent", permission("first", "pending"));
  await store.appendPermissionResponse("agent", permission("second", "pending"));
  await store.appendPermissionResponse("agent", permission("second", "applied"));
  await store.appendPermissionResponse("agent", permission("first", "applied"));
  const page = await store.fetchPermissionResponses("agent", { limit: 3 });
  expect(page.records.map((record) => [record.id, record.status])).toEqual([
    ["first", "applied"],
    ["second", "applied"],
  ]);
  expect(page.nextCursor).toBe(2);
  const older = await store.fetchPermissionResponses("agent", {
    cursor: page.nextCursor,
    limit: 3,
  });
  expect(older.records.map((record) => [record.id, record.status])).toEqual([["first", "applied"]]);
  expect(older.nextCursor).toBeUndefined();
  await store.flush();
  await fs.rm(path.join(directory, "events.index.json"));
  expect(
    (
      await new FileAgentTimelineStore(async () => directory).fetchPermissionResponses("agent", {
        limit: 1,
      })
    ).records[0]?.status,
  ).toBe("applied");
});

it("startup inspection never creates empty journals or rebuilds missing source indexes", async () => {
  const { inspectSummaryRecovery } = await import("./session-summary.js");
  const { directory, store } = await fixture();
  const empty = path.join(directory, "never-opened");
  expect(await inspectSummaryRecovery(empty)).toEqual({ state: "empty" });
  await expect(fs.stat(empty)).rejects.toMatchObject({ code: "ENOENT" });
  await admit(store, "A", actor("A"));
  await commit(store, "A", actor("A"));
  // The readiness probe reads only what a clean shutdown checkpointed.
  await store.flush();
  expect((await inspectSummaryRecovery(directory)).state).toBe("ready");
  const index = path.join(directory, "events.index.json");
  await fs.rm(index);
  expect(await inspectSummaryRecovery(directory)).toEqual({ state: "rebuild" });
  await expect(fs.stat(index)).rejects.toMatchObject({ code: "ENOENT" });
});
it("bounds daemon-owned pending recovery and exposes running/error transitions", async () => {
  const { store } = await fixture();
  const transitions: string[] = [];
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(store, "recoverAuthorship").mockImplementation(async (id) => {
    await barrier;
    if (id === "failed") throw new Error("corrupt journal");
    return { watermark: id, summary: { authorshipStatus: "ready" } };
  });
  store.setAuthorshipRecoveryObserver(async (id, status) => {
    transitions.push(`${id}:${status}`);
  });
  expect(store.scheduleAuthorshipRecovery("failed")).toBe(true);
  for (let index = 0; index < 63; index++)
    expect(store.scheduleAuthorshipRecovery(`queued-${index}`)).toBe(true);
  expect(store.scheduleAuthorshipRecovery("overflow")).toBe(false);
  expect(transitions).toEqual([]);
  await Promise.resolve();
  expect(transitions).toEqual(["failed:recovering"]);
  release();
  await store.flush();
  expect(transitions).toContain("failed:error");
});

it("refills more than 64 demanded sessions and promotes a viewed session in a full queue", async () => {
  const { store } = await fixture();
  const pending = new Set(Array.from({ length: 130 }, (_, index) => `session-${index}`));
  const completed: string[] = [];
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  store.setAuthorshipRecoveryRefill(async () => [...pending].slice(0, 64));
  store.setAuthorshipRecoveryObserver(async (id, status) => {
    if (status === "recovering") pending.delete(id);
  });
  vi.spyOn(store, "recoverAuthorship").mockImplementation(async (id) => {
    if (id === "session-0") await barrier;
    completed.push(id);
    return { watermark: id, summary: { authorshipStatus: "ready" } };
  });
  store.requestAuthorshipRecoverySweep();
  await vi.waitFor(() => expect(pending.has("session-0")).toBe(false));
  // Promote an already queued entry, then admit a newly viewed entry beyond the first batch.
  expect(store.scheduleAuthorshipRecovery("session-63", true)).toBe(true);
  expect(store.scheduleAuthorshipRecovery("session-64")).toBe(true);
  expect(store.scheduleAuthorshipRecovery("session-129", true)).toBe(true);
  expect(store.scheduleAuthorshipRecovery("overflow")).toBe(false);
  release();
  await store.flush();
  expect(completed.slice(0, 3)).toEqual(["session-0", "session-129", "session-63"]);
  expect(new Set(completed)).toEqual(
    new Set(Array.from({ length: 130 }, (_, index) => `session-${index}`)),
  );
  expect(completed).toHaveLength(130);
  expect(pending.size).toBe(0);
});

it("does not strand a viewed session admitted while an empty recovery sweep settles", async () => {
  const { store } = await fixture();
  let injected = false;
  const scheduleLate = () => store.scheduleAuthorshipRecovery("late", true);
  store.setAuthorshipRecoveryRefill(async () => {
    if (!injected) {
      injected = true;
      queueMicrotask(() => queueMicrotask(scheduleLate));
    }
    return [];
  });
  const recover = vi
    .spyOn(store, "recoverAuthorship")
    .mockResolvedValue({ watermark: "late", summary: { authorshipStatus: "ready" } });
  store.requestAuthorshipRecoverySweep();
  await store.flush();
  expect(recover).toHaveBeenCalledExactlyOnceWith("late");
});

it("does not poison unrelated recovery when an active session is permanently deleted", async () => {
  const { directory } = await fixture();
  const store = new FileAgentTimelineStore(async (id) => path.join(directory, id));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const transitions: string[] = [];
  store.setAuthorshipRecoveryObserver(async (id, status) => {
    transitions.push(`${id}:${status}`);
    if (id === "removed" && status === "error") throw new Error("Session record was deleted");
  });
  store.setAuthorshipObserver(async (id) => {
    if (id !== "removed") return;
    entered.resolve();
    await release.promise;
    throw new Error("Session record was deleted");
  });
  store.scheduleAuthorshipRecovery("removed");
  await entered.promise;
  const deleted = store.deleteAgent("removed");
  release.resolve();
  await deleted;
  store.scheduleAuthorshipRecovery("survivor");
  await expect(store.flush()).resolves.toBeUndefined();
  expect(transitions).toEqual(["removed:recovering", "survivor:recovering"]);
  expect((await store.recoverAuthorship("survivor")).summary.authorshipStatus).toBe("ready");
});

it("keeps genuine status observer errors visible when no deletion fence exists", async () => {
  const { store } = await fixture();
  vi.spyOn(store, "recoverAuthorship").mockRejectedValue(new Error("corrupt journal"));
  store.setAuthorshipRecoveryObserver(async (_id, status) => {
    if (status === "error") throw new Error("metadata disk failure");
  });
  store.scheduleAuthorshipRecovery("agent");
  await expect(store.flush()).rejects.toThrow("metadata disk failure");
});

it("bounds latest permission payload bytes and continues without skipping unreturned status positions", async () => {
  const { store, directory } = await fixture();
  const count = 12;
  for (let index = 0; index < count; index++)
    await store.appendPermissionResponse("agent", permission(`large-${index}`, "pending"));
  for (let index = 0; index < count; index++)
    await store.appendPermissionResponse("agent", {
      ...permission(`large-${index}`, "failed"),
      error: "x".repeat(750_000),
    });
  // Missing derived state must also replay large records in byte-bounded pages.
  await fs.rm(path.join(directory, "events.index.json"));
  await store.recoverAuthorship("agent");
  // Page the old tiny pending region, whose current failed snapshots are much larger.
  const first = await store.fetchPermissionResponses("agent", { cursor: count + 1, limit: 200 });
  expect(first.records.length).toBeGreaterThan(0);
  expect(first.records.length).toBeLessThan(count);
  expect(Buffer.byteLength(JSON.stringify(first.records))).toBeLessThan(8 * 1024 * 1024);
  expect(first.records.every((record) => record.status === "failed")).toBe(true);
  expect(first.nextCursor).toBe(count - first.records.length + 1);
  const second = await store.fetchPermissionResponses("agent", {
    cursor: first.nextCursor,
    limit: 200,
  });
  expect(second.nextCursor).toBeUndefined();
  const ids = [...first.records, ...second.records].map((record) => record.id);
  expect(new Set(ids).size).toBe(count);
  expect(ids).toHaveLength(count);
  // A tail page also shortens rather than reading a >8MiB physical span in one allocation.
  expect(
    (await store.fetchPermissionResponses("agent", { limit: 200 })).records.length,
  ).toBeLessThan(count);
}, 30_000);

it("tolerates permanent deletion before the file owner sees its deletion request", async () => {
  const { directory } = await fixture();
  const storage = new AgentStorage(path.join(directory, "records"), createTestLogger(), {
    sessionLayout: true,
  });
  for (const id of ["removed", "survivor"])
    await storage.upsert({
      id,
      provider: "codex",
      cwd: "/work",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  const store = new FileAgentTimelineStore((id) => storage.getSessionDirectory(id));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  store.setAuthorshipRecoveryObserver((id, status) => storage.setAuthorshipStatus(id, status));
  store.setAuthorshipObserver(async (id, summary) => {
    if (id === "removed") {
      entered.resolve();
      await release.promise;
    }
    await storage.applyAuthorship(id, summary);
  });
  store.scheduleAuthorshipRecovery("removed");
  await entered.promise;
  await storage.preparePermanentDelete("removed");
  release.resolve();
  store.scheduleAuthorshipRecovery("survivor");
  await expect(store.flush()).resolves.toBeUndefined();
  expect((await storage.get("survivor"))?.authorshipStatus).toBe("ready");
  await store.deleteAgent("removed");
  await storage.remove("removed");
});
