import { afterEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { AgentStorage } from "../agent-storage.js";
import { rollbackSessionLayout, listSessionRecordPaths } from "./layout.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "session-location-"));
  roots.push(root);
  const storage = new AgentStorage(root, pino({ level: "silent" }), { sessionLayout: true });
  const record = {
    id: "agent",
    provider: "codex",
    cwd: "/work/old",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
  await storage.upsert(record);
  const directory = await storage.getSessionDirectory(record.id);
  const files = ["events-000001.jsonl", "uploads/file/data", "subagents/child/session.json"];
  for (const relative of files) {
    await fs.mkdir(path.dirname(path.join(directory, relative)), { recursive: true });
    await fs.writeFile(path.join(directory, relative), `retained ${relative}`);
  }
  await storage.upsert({ ...record, cwd: "/work/new" });
  await storage.flush();
  return { root, storage, directory, files };
}

it.each(["restart", "rollback", "legacy-cwd-move"])(
  "keeps retained data with its established session directory after %s",
  async (mode) => {
    const { root, directory, files } = await fixture();
    if (mode !== "restart") {
      expect(await rollbackSessionLayout(root)).toBe(1);
      const legacy = new AgentStorage(root, pino({ level: "silent" }));
      const stored = await legacy.get("agent");
      expect(stored?.cwd).toBe("/work/new");
      if (mode === "legacy-cwd-move") {
        // The real feature-off record writer moves a legacy record to its updated cwd.
        await legacy.upsert({ ...stored!, cwd: "/work/third" });
        expect((await listSessionRecordPaths(root))[0]).not.toBe(`${directory}.json`);
      }
    }
    const reopened = new AgentStorage(root, pino({ level: "silent" }), { sessionLayout: true });
    expect(await reopened.getSessionDirectory("agent")).toBe(directory);
    expect((await reopened.get("agent"))?.cwd).toBe(
      mode === "legacy-cwd-move" ? "/work/third" : "/work/new",
    );
    for (const relative of files)
      expect(await fs.readFile(path.join(directory, relative), "utf8")).toBe(
        `retained ${relative}`,
      );
    expect(await listSessionRecordPaths(root)).toEqual([path.join(directory, "session.json")]);
  },
);

it("rejects ambiguous retained directories without moving the legacy record", async () => {
  const { root, directory } = await fixture();
  await rollbackSessionLayout(root);
  const duplicate = path.join(root, "ambiguous", "agent");
  await fs.mkdir(duplicate, { recursive: true });
  await fs.writeFile(path.join(duplicate, "events-000001.jsonl"), "other retained bytes");
  await expect(
    new AgentStorage(root, pino({ level: "silent" }), { sessionLayout: true }).initialize(),
  ).rejects.toThrow("Ambiguous retained session directories");
  expect(await fs.readFile(`${directory}.json`, "utf8")).toContain("agent");
  expect(await fs.readFile(path.join(duplicate, "events-000001.jsonl"), "utf8")).toBe(
    "other retained bytes",
  );
});
