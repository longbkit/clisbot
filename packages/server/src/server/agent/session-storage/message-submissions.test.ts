import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";
import type { MessageSubmission } from "./message-submissions.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});
async function storage() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "submission-admission-"));
  directories.push(directory);
  return { directory, store: new FileAgentTimelineStore(async () => directory) };
}
const record: MessageSubmission = {
  id: "logical",
  digest: "content",
  identity: { actor: { kind: "user", id: "sender", displayName: "Original" } },
  timestamp: "2026-09-11T00:00:00.000Z",
  status: "pending",
};
describe("durable logical message admission", () => {
  it("serializes concurrent admission and preserves the original sender/time across restart", async () => {
    const { directory, store } = await storage();
    const results = await Promise.all([
      store.writeMessageSubmission("agent", record),
      store.writeMessageSubmission("agent", { ...record, timestamp: "later" }),
    ]);
    expect(results.map((result) => result.created)).toEqual([true, false]);
    const restarted = new FileAgentTimelineStore(async () => directory);
    expect((await restarted.writeMessageSubmission("agent", record)).record).toMatchObject(record);
    await restarted.writeMessageSubmission("agent", { ...record, status: "applied" });
    expect(
      (
        await new FileAgentTimelineStore(async () => directory).writeMessageSubmission(
          "agent",
          record,
        )
      ).record.status,
    ).toBe("applied");
  });
  it("rejects changed text or sender snapshot and cannot mark an unadmitted message applied", async () => {
    const { store } = await storage();
    await store.writeMessageSubmission("agent", record);
    await expect(
      store.writeMessageSubmission("agent", { ...record, digest: "changed" }),
    ).rejects.toThrow("immutable");
    await expect(
      store.writeMessageSubmission("agent", {
        ...record,
        identity: { actor: { kind: "user", id: "other" } },
      }),
    ).rejects.toThrow("immutable");
    await expect(
      store.writeMessageSubmission("agent", { ...record, id: "missing", status: "applied" }),
    ).rejects.toThrow("not durably admitted");
  });
});

it("rebuilds a deleted index without readmitting existing IDs", async () => {
  const { directory, store } = await storage();
  await store.writeMessageSubmission("agent", record);
  await fs.unlink(path.join(directory, "events.index.json"));
  expect((await store.writeMessageSubmission("agent", record)).created).toBe(false);
  await fs.writeFile(path.join(directory, "events.index.json"), "not json");
  expect(
    (
      await new FileAgentTimelineStore(async () => directory).writeMessageSubmission(
        "agent",
        record,
      )
    ).created,
  ).toBe(false);
  await store.writeMessageSubmission("agent", { ...record, id: "__proto__" });
  expect(
    (await store.writeMessageSubmission("agent", { ...record, id: "__proto__" })).created,
  ).toBe(false);
});
