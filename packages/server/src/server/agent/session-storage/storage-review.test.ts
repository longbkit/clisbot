import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PagedJournal } from "./paged-journal.js";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";
const roots: string[] = [];
async function temp() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "session-review-"));
  roots.push(directory);
  return directory;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("storage review regressions", () => {
  it("snapshots accepted append inputs and rejects new writes during deletion", async () => {
    const directory = await temp();
    const journal = new PagedJournal<{ text: string }>(directory);
    const value = { text: "accepted" };
    const write = journal.append([{ seq: 1, value }]);
    value.text = "mutated";
    await write;
    expect((await journal.read(1, 1))[0].value.text).toBe("accepted");
    const pending = journal.append([{ seq: 2, value }]);
    const remove = journal.remove();
    await expect(journal.append([{ seq: 3, value }])).rejects.toThrow("deleted");
    await pending;
    await remove;
  });
  it("repairs missing, malformed and invalid-pointer indexes without dropping the page request", async () => {
    const directory = await temp();
    const journal = new PagedJournal<string>(directory);
    await journal.append([{ seq: 1, value: "durable" }]);
    const index = path.join(directory, "index", "0.json");
    for (const damaged of [
      null,
      "{",
      JSON.stringify({
        version: 1,
        epoch: (await journal.state()).epoch,
        entries: { 1: { segment: -1, offset: -8, length: 2 ** 40 } },
      }),
    ]) {
      if (damaged === null) await fs.rm(index);
      else await fs.writeFile(index, damaged);
      expect(await journal.read(1, 1)).toEqual([{ seq: 1, value: "durable" }]);
    }
  });
  it("serializes concurrent allocated sequences and retains all rows", async () => {
    const directory = await temp();
    const store = new FileAgentTimelineStore(async () => directory);
    const rows = await Promise.all(
      Array.from({ length: 20 }, (_, n) =>
        store.appendCommitted("a", { type: "user_message", text: `${n}` }),
      ),
    );
    expect(rows.map((row) => row.seq)).toEqual(Array.from({ length: 20 }, (_, n) => n + 1));
    expect((await store.fetchCommitted("a", { limit: 40 })).rows).toHaveLength(20);
  });
  it("provider lookup separates client IDs and refuses ambiguous provider IDs", async () => {
    const directory = await temp();
    const store = new FileAgentTimelineStore(async () => directory);
    await store.bulkInsert("a", [
      {
        seq: 1,
        timestamp: "2026-09-11",
        providerMessageId: "p1",
        item: {
          type: "user_message",
          text: "A",
          clientMessageId: "c1",
          sender: { kind: "user", id: "A" },
        },
      },
      {
        seq: 2,
        timestamp: "2026-09-11",
        item: {
          type: "user_message",
          text: "B",
          clientMessageId: "p1",
          sender: { kind: "user", id: "B" },
        },
      },
    ]);
    expect((await store.getUserMessageByProviderId("a", "p1"))?.seq).toBe(1);
    expect((await store.getSubmittedUserMessage("a", "p1"))?.seq).toBe(2);
    await store.bulkInsert("a", [
      {
        seq: 3,
        timestamp: "2026-09-11",
        providerMessageId: "p1",
        item: { type: "user_message", text: "C" },
      },
    ]);
    expect(await store.getUserMessageByProviderId("a", "p1")).toBeNull();
    await fs.rm(path.join(directory, "events.index.json"));
    expect(await store.getUserMessageByProviderId("a", "p1")).toBeNull();
    expect(
      await new FileAgentTimelineStore(async () => directory).getUserMessageByProviderId("a", "p1"),
    ).toBeNull();
  });
  it("advances permission cursor on status updates and returns latest status by ID", async () => {
    const directory = await temp();
    const store = new FileAgentTimelineStore(async () => directory);
    const record = {
      id: "response",
      timestamp: "2026-09-11T00:00:00.000Z",
      request: { id: "request", kind: "tool" as const },
      response: { behavior: "allow" as const },
      status: "pending" as const,
    };
    await store.appendPermissionResponse("a", record);
    const pending = await store.fetchPermissionResponses("a");
    await store.appendPermissionResponse("a", { ...record, status: "applied" });
    expect(
      (await store.fetchPermissionResponses("a", { cursor: pending.nextCursor })).records[0].status,
    ).toBe("applied");
    expect((await store.readPermissionResponse("a", record.id))?.status).toBe("applied");
  });
  it("replaces epoch without losing session metadata or the rebuildable index", async () => {
    const directory = await temp();
    const store = new FileAgentTimelineStore(async () => directory);
    await fs.writeFile(path.join(directory, "session.json"), "metadata");
    await store.appendCommitted("a", {
      type: "user_message",
      text: "old",
      sender: { kind: "user", id: "A" },
    });
    const oldEpoch = await store.getEpoch("a");
    const epoch = await store.resetCommitted("a");
    await store.appendCommitted("a", { type: "user_message", text: "new" });
    const restored = new FileAgentTimelineStore(async () => directory);
    const page = await restored.fetchCommitted("a");
    expect(epoch).not.toBe(oldEpoch);
    expect(page.epoch).toBe(epoch);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].seq).toBe(1);
    expect(page.rows[0].item).toEqual({ type: "user_message", text: "new" });
    expect(await fs.readFile(path.join(directory, "session.json"), "utf8")).toBe("metadata");
    await fs.rm(path.join(directory, "events.index.json"));
    expect(
      (await new FileAgentTimelineStore(async () => directory).fetchCommitted("a")).rows[0].item,
    ).toEqual({ type: "user_message", text: "new" });
  });
  it("commits complete replacement atomically and ignores interrupted replacement epochs", async () => {
    const directory = await temp();
    const journal = new PagedJournal<string>(directory);
    await journal.append([{ seq: 1, value: "original" }]);
    const originalEpoch = (await journal.state()).epoch;
    await expect(
      journal.replace([
        { seq: 1, value: "x".repeat(600000) },
        { seq: 2, value: "y".repeat(600000) },
        { seq: 4, value: "invalid sequence" },
      ]),
    ).rejects.toThrow("contiguous");
    const recovered = new PagedJournal<string>(directory);
    expect((await recovered.state()).epoch).toBe(originalEpoch);
    expect(await recovered.read(1, 1)).toEqual([{ seq: 1, value: "original" }]);
    const epoch = await recovered.replace([{ seq: 1, value: "replacement" }]);
    expect((await new PagedJournal<string>(directory).state()).epoch).toBe(epoch);
    expect(await new PagedJournal<string>(directory).read(1, 1)).toEqual([
      { seq: 1, value: "replacement" },
    ]);
  });
  it("uses one owner through eviction and rejects writes after permanent deletion", async () => {
    const directory = await temp();
    const store = new FileAgentTimelineStore(async (id) => path.join(directory, id));
    for (let n = 0; n < 135; n += 1)
      await store.appendCommitted(`${n}`, { type: "user_message", text: `${n}` });
    expect((await store.appendCommitted("0", { type: "user_message", text: "again" })).seq).toBe(2);
    const deleted = store.deleteAgent("0");
    await expect(store.appendCommitted("0", { type: "user_message", text: "no" })).rejects.toThrow(
      "deleted",
    );
    await deleted;
  }, 90000);
  it("surfaces injected ENOSPC without acknowledging or continuing the journal", async () => {
    const directory = await temp();
    const journal = new PagedJournal<string>(directory);
    await journal.state();
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(((...args: Parameters<typeof fs.open>) => {
      if (String(args[0]).endsWith(".jsonl"))
        return Promise.reject(Object.assign(new Error("injected disk full"), { code: "ENOSPC" }));
      return open(...args);
    }) as typeof fs.open);
    await expect(journal.append([{ seq: 1, value: "not acknowledged" }])).rejects.toMatchObject({
      code: "ENOSPC",
    });
    await expect(journal.flush()).rejects.toMatchObject({ code: "ENOSPC" });
  });
});

describe("process crash recovery", () => {
  for (const boundary of ["before-log-sync", "after-log-sync", "before-checkpoint-rename"]) {
    it(`retains acknowledged data after SIGKILL ${boundary}`, async () => {
      const directory = await temp();
      const script = path.join(directory, "kill-fixture.mts");
      const module = pathToFileURL(
        path.join(process.cwd(), "src/server/agent/session-storage/paged-journal.ts"),
      ).href;
      await fs.writeFile(
        script,
        `import { promises as fs } from "node:fs";\nimport { PagedJournal } from ${JSON.stringify(module)};\nconst journal = new PagedJournal(process.argv[2]);\nawait journal.append([{seq:1,value:"acknowledged"}]);\nprocess.stdout.write("acknowledged\\n");\nconst boundary=process.argv[3];\nconst open=fs.open.bind(fs);\nfs.open=async (...args)=>{ const handle=await open(...args); if(String(args[0]).endsWith(".jsonl")){ const sync=handle.sync.bind(handle); handle.sync=async()=>{ if(boundary==="before-log-sync") process.kill(process.pid,"SIGKILL"); await sync(); if(boundary==="after-log-sync") process.kill(process.pid,"SIGKILL"); }; } return handle; };\nconst rename=fs.rename.bind(fs);\nfs.rename=async (...args)=>{ if(boundary==="before-checkpoint-rename" && String(args[1]).endsWith("events-000001.index.json")) process.kill(process.pid,"SIGKILL"); return rename(...args); };\nawait journal.append([{seq:2,value:"unacknowledged"}]);\n`,
      );
      const child = spawn(process.execPath, ["--import", "tsx", script, directory, boundary], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data) => {
        stdout += data;
      });
      child.stderr.on("data", (data) => {
        stderr += data;
      });
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.once("error", reject);
          child.once("exit", (code, signal) => resolve({ code, signal }));
        },
      );
      expect(stderr).toBe("");
      expect(stdout).toContain("acknowledged");
      expect(result.signal).toBe("SIGKILL");
      expect(await new PagedJournal<string>(directory).read(1, 1)).toEqual([
        { seq: 1, value: "acknowledged" },
      ]);
    }, 10000);
  }
});
