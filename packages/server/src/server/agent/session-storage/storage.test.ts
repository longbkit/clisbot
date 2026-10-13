import { describe, expect, it, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PagedJournal, SESSION_STORAGE_LIMITS } from "./paged-journal.js";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";
import { AgentStorage } from "../agent-storage.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { SessionEventLog } from "./session-event-log.js";
import { scanSessionEventLines, INDEX_SCAN_LINE_BYTES } from "./session-event-scan.js";
import { rollbackSessionLayout } from "./layout.js";

const roots: string[] = [];
async function temporary(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-storage-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  vi.restoreAllMocks();
  SessionEventLog.forgetAll();
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
  it("keeps a completed upgrade usable after checkpoint failure without rescanning", async () => {
    const directory = await temporary();
    const log = SessionEventLog.for(directory);
    const rows = Array.from({ length: 300 }, (_, index) => ({
      seq: index + 1,
      value: { seq: index + 1, item: { type: "tool_call", callId: "child" } },
    }));
    await log.append("timeline", rows);
    await log.flush();
    const indexPath = path.join(directory, "events.index.json");
    const old = JSON.parse(await fs.readFile(indexPath, "utf8"));
    old.version = 2;
    old.tools.child = old.tools.child.slice(0, 256);
    const saved = JSON.stringify(old);
    await fs.writeFile(indexPath, saved);
    SessionEventLog.forget(directory);
    const restored = SessionEventLog.for(directory);
    const rename = vi
      .spyOn(fs, "rename")
      .mockRejectedValueOnce(new Error("simulated rename failure"));
    const failed = await Promise.allSettled([
      restored.state("timeline"),
      restored.state("permission"),
    ]);
    expect(failed.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await fs.readFile(indexPath, "utf8")).toBe(saved);
    expect((await fs.readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    rename.mockRestore();
    const open = fs.open.bind(fs);
    let scans = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === path.join(directory, "events.jsonl") && args[1] === "r") scans++;
      return open(...args);
    });
    await Promise.all([
      restored.state("timeline"),
      restored.state("permission"),
      restored.append("timeline", [{ seq: 301, value: { ...rows[0]!.value, seq: 301 } }]),
    ]);
    expect(scans).toBe(0);
    await restored.flush();
    SessionEventLog.forget(directory);
    const cold = SessionEventLog.for(directory);
    expect((await cold.state("timeline")).maxSeq).toBe(301);
    expect((await cold.toolOccurrences("child")).seqs).toEqual(
      Array.from({ length: 301 }, (_, i) => i + 1),
    );
    expect(scans).toBe(0);
  });

  it("separates a torn tail from a new append and survives index loss", async () => {
    const directory = await temporary();
    const log = SessionEventLog.for(directory);
    await log.append("timeline", [{ seq: 1, value: "first" }]);
    await log.flush();
    await fs.appendFile(
      path.join(directory, "events.jsonl"),
      '{"kind":"timeline","seq":2,"value":',
    );
    SessionEventLog.forget(directory);
    await SessionEventLog.for(directory).append("timeline", [{ seq: 3, value: "third" }]);
    await fs.rm(path.join(directory, "events.index.json"));
    SessionEventLog.forget(directory);
    expect(await SessionEventLog.for(directory).read("timeline", 1, 3)).toEqual([
      { seq: 1, value: "first" },
      { seq: 3, value: "third" },
    ]);
  });

  it("keeps replacement pointers usable after an index save failure", async () => {
    const directory = await temporary();
    const log = SessionEventLog.for(directory);
    await log.append("timeline", [{ seq: 1, value: "old" }]);
    await log.flush();
    const rename = fs.rename.bind(fs);
    const fail = vi
      .spyOn(fs, "rename")
      .mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
        if (String(args[1]).endsWith("events.index.json")) throw new Error("checkpoint failed");
        return rename(...args);
      });
    await expect(log.replace("timeline", [{ seq: 1, value: "new value" }])).rejects.toThrow(
      "checkpoint failed",
    );
    expect(await log.read("timeline", 1, 1)).toEqual([{ seq: 1, value: "new value" }]);
    fail.mockRestore();
    SessionEventLog.forget(directory);
    expect(await SessionEventLog.for(directory).read("timeline", 1, 1)).toEqual([
      { seq: 1, value: "new value" },
    ]);
  });

  it("indexes an old row over the page limit while keeping neighbours readable", async () => {
    const directory = await temporary();
    const log = SessionEventLog.for(directory);
    await log.append("timeline", [
      { seq: 1, value: "before" },
      { seq: 2, value: "x".repeat(9 * 1024 * 1024) },
      { seq: 3, value: "after" },
    ]);
    await fs.rm(path.join(directory, "events.index.json"), { force: true });
    SessionEventLog.forget(directory);
    const cold = SessionEventLog.for(directory);
    expect((await cold.state("timeline")).maxSeq).toBe(3);
    expect(await cold.read("timeline", 3, 3)).toEqual([{ seq: 3, value: "after" }]);
    await expect(cold.read("timeline", 2, 2)).rejects.toThrow("byte budget");
  });

  it("does not recreate a removed log after a concurrent cold load", async () => {
    const directory = await temporary();
    const log = SessionEventLog.for(directory);
    await Promise.allSettled([log.state("timeline"), log.remove()]);
    await expect(log.state("timeline")).rejects.toThrow("deleted");
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("streams lazily and releases the scanner gate on early return and oversized-line failure", async () => {
    const directory = await temporary();
    const journal = path.join(directory, "scan.jsonl");
    const text = "first\n" + "x".repeat(INDEX_SCAN_LINE_BYTES + 1);
    await fs.writeFile(journal, text);
    const open = fs.open.bind(fs);
    let readBytes = 0;
    const spy = vi
      .spyOn(fs, "open")
      .mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        const handle = await open(...args);
        const read = handle.read.bind(handle);
        async function trackedRead(...readArgs: Parameters<typeof read>) {
          const result = await read(...readArgs);
          readBytes += result.bytesRead;
          return result;
        }
        vi.spyOn(handle, "read").mockImplementation(trackedRead);
        return handle;
      });
    const scan = scanSessionEventLines(journal, 0, Buffer.byteLength(text));
    expect((await scan.next()).value?.line).toBe("first");
    expect(readBytes).toBe(64 * 1024);
    await scan.return(undefined);
    spy.mockRestore();
    const all = async () => {
      for await (const _line of scanSessionEventLines(journal, 0, Buffer.byteLength(text))) {
        /* consume */
      }
    };
    await expect(all()).rejects.toThrow("index scan byte budget");
    const final = scanSessionEventLines(journal, 0, 5);
    expect((await final.next()).value).toEqual({ line: "first", offset: 0, length: 5 });
    await final.return(undefined);
  });

  it("preserves a complete final JSON record without newline when appending", async () => {
    const directory = await temporary();
    const journal = path.join(directory, "events.jsonl");
    const line = JSON.stringify({ kind: "timeline", epoch: "old", seq: 1, value: "complete" });
    await fs.writeFile(journal, line);
    const log = SessionEventLog.for(directory);
    await log.append("timeline", [{ seq: 2, value: "next" }]);
    await fs.rm(path.join(directory, "events.index.json"), { force: true });
    SessionEventLog.forget(directory);
    expect(await SessionEventLog.for(directory).read("timeline", 1, 2)).toEqual([
      { seq: 1, value: "complete" },
      { seq: 2, value: "next" },
    ]);
  });

  it("keeps durable appends successful and backs off persistent checkpoint failures", async () => {
    const directory = await temporary();
    const rename = fs.rename.bind(fs);
    let attempts = 0;
    vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const failure = vi
      .spyOn(fs, "rename")
      .mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
        if (String(args[1]).endsWith("events.index.json")) {
          attempts++;
          throw new Error("persistent checkpoint failure");
        }
        return rename(...args);
      });
    const log = SessionEventLog.for(directory);
    for (let seq = 1; seq <= 130; seq++)
      await expect(log.append("timeline", [{ seq, value: seq }])).resolves.toBeUndefined();
    expect(attempts).toBeLessThanOrEqual(4);
    SessionEventLog.forget(directory);
    const cold = SessionEventLog.for(directory);
    expect((await cold.state("timeline")).maxSeq).toBe(130);
    expect(await cold.read("timeline", 130, 130)).toEqual([{ seq: 130, value: 130 }]);
    await expect(cold.flush()).rejects.toThrow("persistent checkpoint failure");
    failure.mockRestore();
    await expect(cold.flush()).resolves.toBeUndefined();
  });

  it("caches oversized-row scan failure until the journal changes", async () => {
    const directory = await temporary();
    const journal = path.join(directory, "events.jsonl");
    await fs.writeFile(journal, "x".repeat(INDEX_SCAN_LINE_BYTES + 1));
    const open = fs.open.bind(fs);
    let scans = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === journal && args[1] === "r") scans++;
      return open(...args);
    });
    const log = SessionEventLog.for(directory);
    await expect(log.state("timeline")).rejects.toThrow(`${journal} at byte 0`);
    await expect(log.state("timeline")).rejects.toThrow("index scan byte budget");
    expect(scans).toBe(1);
    await fs.writeFile(
      journal,
      JSON.stringify({ kind: "timeline", epoch: "repaired", seq: 1, value: "ok" }) + "\n",
    );
    expect((await log.state("timeline")).maxSeq).toBe(1);
    expect(scans).toBe(2);
  });

  it("upgrades complete v2 lists without scanning the journal body", async () => {
    const directory = await temporary();
    const log = SessionEventLog.for(directory);
    await log.append("timeline", [
      { seq: 1, value: { seq: 1, item: { type: "tool_call", callId: "short" } } },
    ]);
    await log.flush();
    const indexPath = path.join(directory, "events.index.json");
    const saved = JSON.parse(await fs.readFile(indexPath, "utf8"));
    saved.version = 2;
    await fs.writeFile(indexPath, JSON.stringify(saved));
    SessionEventLog.forget(directory);
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === path.join(directory, "events.jsonl"))
        throw new Error("Unnecessary journal read");
      return open(...args);
    });
    expect((await SessionEventLog.for(directory).state("timeline")).maxSeq).toBe(1);
    expect(JSON.parse(await fs.readFile(indexPath, "utf8"))).toEqual({ ...saved, version: 3 });
  });

  it("streams a journal over 100 MiB for upgrade, rebuild and uncheckpointed-tail recovery", async () => {
    const directory = await temporary();
    const log = SessionEventLog.for(directory);
    const text = "界".repeat(24_000);
    for (let start = 1; start <= 1500; start += 16) {
      await log.append(
        "timeline",
        Array.from({ length: Math.min(16, 1501 - start) }, (_, i) => ({
          seq: start + i,
          value: {
            seq: start + i,
            timestamp: "2026-10-13",
            item: {
              type: "tool_call",
              callId: "long",
              name: "Sub-agent",
              status: "running",
              detail: { type: "unknown", input: {}, output: text },
              error: null,
            },
          },
        })),
      );
    }
    await log.flush();
    const journal = path.join(directory, "events.jsonl");
    const size = (await fs.stat(journal)).size;
    expect(size).toBeGreaterThan(100 * 1024 * 1024);
    const indexPath = path.join(directory, "events.index.json");
    const saved = JSON.parse(await fs.readFile(indexPath, "utf8"));
    saved.version = 2;
    saved.tools.long = saved.tools.long.slice(0, 256);
    saved.summary = { retained: true };
    saved.ids["repair:external"] = 17;
    saved.revision = 9;
    saved.operationOrder = 77;
    await fs.writeFile(indexPath, JSON.stringify(saved));
    const readFile = fs.readFile.bind(fs);
    vi.spyOn(fs, "readFile").mockImplementation((...args: Parameters<typeof fs.readFile>) => {
      if (String(args[0]) === journal) throw new Error("Whole-journal read forbidden");
      return readFile(...args);
    });
    const open = fs.open.bind(fs);
    let maxRead = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (String(args[0]) === journal) {
        const read = handle.read.bind(handle);
        handle.read = (async (...readArgs: Parameters<typeof handle.read>) => {
          const result = await read(...readArgs);
          maxRead = Math.max(maxRead, result.bytesRead);
          return result;
        }) as typeof handle.read;
      }
      return handle;
    });
    for (const mode of ["upgrade", "rebuild", "tail"] as const) {
      if (mode === "rebuild") await fs.rm(indexPath);
      if (mode === "tail")
        await fs.writeFile(
          indexPath,
          JSON.stringify({
            ...saved,
            version: 3,
            scannedBytes: 0,
            pointers: {},
            tools: {},
            ids: {},
            anchors: [],
          }),
        );
      SessionEventLog.forget(directory);
      const restored = SessionEventLog.for(directory);
      expect((await restored.state("timeline")).maxSeq).toBe(1500);
      expect((await restored.toolOccurrences("long")).seqs).toEqual(
        Array.from({ length: 1500 }, (_, i) => i + 1),
      );
      if (mode === "upgrade") {
        expect(await restored.readSummary()).toEqual({ retained: true });
        expect(await restored.lookupId("repair", "external")).toBe(17);
        expect(await restored.state("timeline")).toMatchObject({ revision: 9, operationOrder: 77 });
      }
      expect(maxRead).toBeLessThanOrEqual(64 * 1024);
      const last = await restored.read<{ item: { detail: { output: string } } }>(
        "timeline",
        1500,
        1500,
      );
      expect(last[0]!.value.item.detail.output).toBe(text);
      maxRead = 0;
    }
    expect((await fs.stat(journal)).size).toBe(size);
  });

  it("rebuilds old tool indexes without changing ledgers, message anchors or canonical bytes", async () => {
    const directory = await temporary();
    const log = SessionEventLog.for(directory);
    const rows = Array.from({ length: 300 }, (_, index) => ({
      seq: index + 2,
      timestamp: "2026-10-13",
      turnId: "turn",
      item: {
        type: "tool_call",
        callId: "child",
        name: "Sub-agent",
        status: "running",
        detail: { type: "unknown", input: {}, output: String(index) },
        error: null,
      },
    }));
    await log.append("timeline", [
      {
        seq: 1,
        value: {
          seq: 1,
          timestamp: "2026-10-13",
          item: { type: "user_message", messageId: "prompt", text: "main" },
        },
      },
      ...rows.map((value) => ({ seq: value.seq, value })),
    ]);
    await log.append("submission", [{ seq: 1, value: { id: "submission", status: "committed" } }]);
    await log.append("permission", [{ seq: 1, value: { id: "permission", response: "allow" } }]);
    // A rewrite must not add a duplicate occurrence or change which value is returned.
    const revised = { ...rows[0]!, item: { ...rows[0]!.item, status: "completed" } };
    await log.append("timeline", [{ seq: revised.seq, value: revised }]);
    await log.flush();
    const canonical = await fs.readFile(path.join(directory, "events.jsonl"));
    const epoch = (await log.state("timeline")).epoch;
    const indexPath = path.join(directory, "events.index.json");
    const oldIndex = JSON.parse(await fs.readFile(indexPath, "utf8"));
    oldIndex.version = 2;
    oldIndex.tools.child = oldIndex.tools.child.slice(0, 256);
    await fs.writeFile(indexPath, JSON.stringify(oldIndex));
    SessionEventLog.forget(directory);
    const restored = SessionEventLog.for(directory);
    expect((await restored.state("timeline")).epoch).toBe(epoch);
    expect(await restored.toolOccurrences("child")).toEqual({
      seqs: rows.map((row) => row.seq),
      complete: true,
    });
    expect(await restored.read("timeline", 2, 2)).toEqual([{ seq: 2, value: revised }]);
    expect(await restored.read("submission", 1, 1)).toEqual([
      { seq: 1, value: { id: "submission", status: "committed" } },
    ]);
    expect(await restored.read("permission", 1, 1)).toEqual([
      { seq: 1, value: { id: "permission", response: "allow" } },
    ]);
    expect(await restored.anchors()).toEqual(oldIndex.anchors);
    expect(await fs.readFile(path.join(directory, "events.jsonl"))).toEqual(canonical);
    await restored.append("timeline", [{ seq: 302, value: { ...rows[0]!, seq: 302 } }]);
    expect((await restored.toolOccurrences("child")).seqs).toEqual([
      ...rows.map((row) => row.seq),
      302,
    ]);
    SessionEventLog.forget(directory);
  });

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
    expect(index.version).toBe(3);
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
