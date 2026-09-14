import { describe, expect, it, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PagedJournal, SESSION_STORAGE_LIMITS } from "./paged-journal.js";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";
import { AgentStorage } from "../agent-storage.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { rollbackSessionLayout } from "./layout.js";

const roots: string[] = [];
async function temporary(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-storage-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function record(id: string) {
  return {
    id,
    provider: "codex",
    cwd: "/work/demo",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    futureField: { preserved: true },
  };
}

describe("session layout", () => {
  it("migrates raw bytes, reads with feature off, and rolls back only the canonical record", async () => {
    const base = await temporary();
    const bytes = JSON.stringify(record("a"), null, 2) + "\n";
    await fs.writeFile(path.join(base, "a.json"), bytes);
    const storage = new AgentStorage(base, createTestLogger(), {
      sessionLayout: true,
    });
    await storage.initialize();
    const directory = await storage.getSessionDirectory("a");
    expect(await fs.readFile(path.join(directory, "session.json"), "utf8")).toBe(bytes);
    await fs.writeFile(path.join(directory, "events-000001.jsonl"), "sentinel\n");
    await fs.mkdir(path.join(directory, "subagents", "x"), { recursive: true });
    await fs.writeFile(
      path.join(directory, "subagents", "x", "session.json"),
      "not an agent record",
    );
    expect(
      (await new AgentStorage(base, createTestLogger()).list()).map((item) => item.id),
    ).toEqual(["a"]);
    expect(await rollbackSessionLayout(base)).toBe(1);
    expect(await fs.readFile(`${directory}.json`, "utf8")).toBe(bytes);
    expect(await fs.readFile(path.join(directory, "events-000001.jsonl"), "utf8")).toBe(
      "sentinel\n",
    );
  });
  it("fails loudly on conflicting duplicate records and invalid records", async () => {
    const base = await temporary();
    await fs.writeFile(path.join(base, "a.json"), JSON.stringify(record("a")));
    await fs.mkdir(path.join(base, "project"));
    await fs.writeFile(
      path.join(base, "project", "a.json"),
      JSON.stringify({ ...record("a"), title: "conflict" }),
    );
    await expect(
      new AgentStorage(base, createTestLogger(), {
        sessionLayout: true,
      }).list(),
    ).rejects.toThrow("Conflicting records");
    const corrupt = await temporary();
    await fs.writeFile(path.join(corrupt, "a.json"), "{");
    await expect(new AgentStorage(corrupt, createTestLogger()).list()).rejects.toThrow();
  });
});

describe("durable paged journal", () => {
  it("preserves epoch, latest row revisions, rotation and bounded indexed reads across restart", async () => {
    const directory = await temporary();
    const journal = new PagedJournal<{ text: string }>(directory, 12000);
    const epoch = (await journal.state()).epoch;
    await Promise.all(
      Array.from({ length: 600 }, (_, index) =>
        journal.append([{ seq: index + 1, value: { text: `row ${index + 1}` } }]),
      ),
    );
    await journal.append([{ seq: 5, value: { text: "revised" } }]);
    const restored = new PagedJournal<{ text: string }>(directory);
    expect((await restored.state()).epoch).toBe(epoch);
    expect((await restored.read(5, 5))[0].value.text).toBe("revised");
    expect(await restored.read(561, 600)).toHaveLength(40);
    expect(
      (await fs.readdir(directory)).filter((file) => file.endsWith(".jsonl")).length,
    ).toBeGreaterThan(1);
  });
  it("rebuilds lost indexes, truncates only an incomplete final tail, and rejects interior corruption", async () => {
    const directory = await temporary();
    const journal = new PagedJournal<string>(directory);
    await journal.append([
      { seq: 1, value: "committed" },
      { seq: 2, value: "second" },
    ]);
    const file = path.join(directory, "events-000001.jsonl");
    const good = await fs.readFile(file, "utf8");
    await fs.appendFile(file, '{"version":1,');
    const recovered = new PagedJournal<string>(directory);
    expect(await recovered.read(1, 2)).toEqual([
      { seq: 1, value: "committed" },
      { seq: 2, value: "second" },
    ]);
    expect(await fs.readFile(file, "utf8")).toBe(good);
    await fs.rm(path.join(directory, "events-000001.index.json"));
    expect(await new PagedJournal<string>(directory).read(2, 2)).toEqual([
      { seq: 2, value: "second" },
    ]);
    await fs.writeFile(file, good.replace('"committed"', "corruption"));
    await fs.rm(path.join(directory, "events-000001.index.json"));
    await expect(new PagedJournal<string>(directory).read(1, 2)).rejects.toThrow("Corrupt journal");
  });
  it("rejects overload before admission and never deletes the owning session record", async () => {
    const directory = await temporary();
    const journal = new PagedJournal<string>(directory);
    await expect(
      journal.append([{ seq: 1, value: "x".repeat(SESSION_STORAGE_LIMITS.batchBytes + 1) }]),
    ).rejects.toThrow("overloaded");
    await fs.writeFile(path.join(directory, "session.json"), "metadata");
    await journal.append([{ seq: 1, value: "ok" }]);
    await journal.remove();
    expect(await fs.readFile(path.join(directory, "session.json"), "utf8")).toBe("metadata");
    await expect(journal.append([{ seq: 2, value: "no" }])).rejects.toThrow("deleted");
  });
  it("fails durable acknowledgement on a real filesystem write error", async () => {
    const directory = await temporary();
    const journal = new PagedJournal<string>(directory);
    await journal.state();
    await fs.mkdir(path.join(directory, "events-000001.jsonl"));
    await expect(journal.append([{ seq: 1, value: "must fail" }])).rejects.toThrow();
    await expect(journal.flush()).rejects.toThrow();
  });
});

describe("file timeline", () => {
  it("writes lightweight user-message anchors for fast jump without scanning the journal", async () => {
    const directory = await temporary();
    const store = new FileAgentTimelineStore(async () => directory);
    await store.bulkInsert("a", [
      {
        seq: 1,
        timestamp: "2026-01-01",
        item: { type: "user_message", messageId: "m1", text: "  hello   world " },
      },
      {
        seq: 2,
        timestamp: "2026-01-01",
        item: { type: "assistant_message", messageId: "a1", text: "reply" },
      },
      {
        seq: 3,
        timestamp: "2026-01-01",
        item: { type: "user_message", messageId: "m2", text: "second" },
      },
    ]);
    await store.flush();
    const canonical = (await fs.readFile(path.join(directory, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string; value: { seq: number } });
    expect(canonical.map((entry) => [entry.kind, entry.value.seq])).toEqual([
      ["timeline", 1],
      ["timeline", 2],
      ["timeline", 3],
    ]);
    const index = JSON.parse(
      await fs.readFile(path.join(directory, "events.index.json"), "utf8"),
    ) as {
      version: number;
      anchors: Array<{ messageId: string; preview: string; epoch: string; seq: number }>;
    };
    expect(index.version).toBe(2);
    expect(
      index.anchors.map(({ messageId, preview, seq }) => ({ messageId, preview, seq })),
    ).toEqual([
      { messageId: "m1", preview: "hello world", seq: 1 },
      { messageId: "m2", preview: "second", seq: 3 },
    ]);
    expect(index.anchors[0]?.epoch).toBe(await store.getEpoch("a"));
    await fs.writeFile(path.join(directory, "events.index.json"), "corrupt");
    await store.appendCommitted("a", { type: "user_message", messageId: "m3", text: "third" });
    await store.flush();
    const recovered = JSON.parse(
      await fs.readFile(path.join(directory, "events.index.json"), "utf8"),
    ) as { anchors: Array<{ messageId: string }> };
    expect(recovered.anchors.map((anchor) => anchor.messageId)).toEqual(["m1", "m2", "m3"]);
    const originalEpoch = await store.getEpoch("a");
    for (const name of await fs.readdir(directory)) {
      if (name.startsWith("events-") || name === "checkpoint.json") {
        await fs.rm(path.join(directory, name), { recursive: true, force: true });
      }
    }
    const canonicalOnly = new FileAgentTimelineStore(async () => directory);
    const restoredPage = await canonicalOnly.fetchCommitted("a", { limit: 10 });
    expect(restoredPage.epoch).toBe(originalEpoch);
    expect(await canonicalOnly.getEpoch("a")).toBe(originalEpoch);
    expect(restoredPage.rows.map((row) => row.seq)).toEqual([1, 2, 3, 4]);
    expect(await canonicalOnly.getLatestCommittedSeq("a")).toBe(4);
    expect((await canonicalOnly.getCommittedRows("a")).map((row) => row.seq)).toEqual([1, 2, 3, 4]);
    const promptIndex = await canonicalOnly.listPromptIndex("a");
    expect(promptIndex.prompts.map((prompt) => prompt.seq)).toEqual([1, 3, 4]);
    expect(promptIndex.prompts[0]?.preview).toBe("hello world");
  });

  it("pages the persisted tail without provider initialization and recovers submitted message lookup", async () => {
    const directory = await temporary();
    const store = new FileAgentTimelineStore(async () => directory);
    await store.bulkInsert(
      "a",
      Array.from({ length: 1000 }, (_, index) => ({
        seq: index + 1,
        timestamp: "2026-01-01",
        item: {
          type: "user_message" as const,
          text: `message ${index}`,
          ...(index === 3 ? { clientMessageId: "m3" } : {}),
        },
      })),
    );
    const restored = new FileAgentTimelineStore(async () => directory);
    const tail = await restored.fetchCommitted("a", { limit: 40 });
    expect(tail.rows.map((row) => row.seq)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 961),
    );
    expect(tail.hasOlder).toBe(true);
    expect(
      (
        await restored.fetchCommitted("a", {
          direction: "before",
          cursor: { epoch: tail.epoch, seq: 961 },
          limit: 40,
        })
      ).rows[0].seq,
    ).toBe(921);
    expect((await restored.getSubmittedUserMessage("a", "m3"))?.seq).toBe(4);
    expect(
      (
        await restored.fetchCommitted("a", {
          cursor: { epoch: "wrong", seq: 500 },
          limit: 40,
        })
      ).staleCursor,
    ).toBe(true);
  });
});
