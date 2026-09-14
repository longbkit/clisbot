import { afterEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { AgentStorage } from "../agent-storage.js";
import {
  assertAgentNotDeleted,
  sessionDeletionIntentPath,
  writeSessionDeletionIntent,
} from "./deletion-intents.js";
import {
  withSessionFileOperation,
  sessionFileActivityUsage,
} from "../../file-upload/session-file-activity.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});
async function temporary() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "session-delete-crash-"));
  roots.push(directory);
  return directory;
}
function record(id: string) {
  return {
    id,
    provider: "codex",
    cwd: "/work/demo",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}
async function crashAt(directory: string, phase: string) {
  const script = `
    const fs = await import('node:fs/promises'); const path = await import('node:path');
    const { AgentStorage } = await import(process.argv[2]); const pino = (await import('pino')).default;
    const storage = new AgentStorage(path.dirname(path.dirname(process.argv[1])), pino({level:'silent'}));
    await storage.preparePermanentDelete('agent');
    if (process.argv[3] === 'partial') {
      await fs.rm(path.join(process.argv[1], 'events-000001.jsonl'));
      const handle = await fs.open(process.argv[1], 'r'); await handle.sync(); await handle.close();
    }
    process.kill(process.pid, 'SIGKILL');
  `;
  return new Promise<string | null>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        script,
        directory,
        new URL("../agent-storage.ts", import.meta.url).href,
        phase,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (bytes: Buffer) => {
      stderr = (stderr + bytes.toString()).slice(-4096);
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal === "SIGKILL") resolve(signal);
      else reject(new Error(`Child exited ${code}: ${stderr}`));
    });
  });
}
it.each(["intent", "partial"])(
  "finishes a durable deletion after process kill at %s, including legacy record copies",
  async (phase) => {
    const root = await temporary();
    const directory = path.join(root, "cwd", "agent");
    await fs.mkdir(path.join(directory, "uploads"), { recursive: true });
    await fs.writeFile(path.join(directory, "session.json"), JSON.stringify(record("agent")));
    await fs.writeFile(`${directory}.json`, JSON.stringify(record("agent")));
    await fs.writeFile(path.join(root, "agent.json"), JSON.stringify(record("agent")));
    await fs.writeFile(path.join(root, "cwd", "keeper.json"), JSON.stringify(record("keeper")));
    await fs.writeFile(path.join(directory, "events-000001.jsonl"), "acknowledged history");
    await fs.writeFile(path.join(directory, "uploads", "file"), "retained bytes");
    expect(await crashAt(directory, phase)).toBe("SIGKILL");
    expect(await fs.readFile(path.join(directory, "session.json"), "utf8")).toContain("agent");
    const storage = new AgentStorage(root, pino({ level: "silent" }));
    expect((await storage.list()).map((item) => item.id)).toEqual(["keeper"]);
    await expect(fs.stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(`${directory}.json`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      JSON.parse(await fs.readFile(sessionDeletionIntentPath(directory), "utf8")),
    ).toMatchObject({ version: 1, target: "agent" });
    await expect(fs.stat(path.join(root, "agent.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      withSessionFileOperation(directory, async () => fs.mkdir(directory)),
    ).rejects.toThrow("deleted");
    expect(sessionFileActivityUsage().owners).toBe(0);
  },
);
it("rejects malformed deletion scope and mismatched record ownership before deleting bytes", async () => {
  const root = await temporary();
  const directory = path.join(root, "cwd", "agent");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "session.json"), JSON.stringify(record("someone-else")));
  await writeSessionDeletionIntent(directory);
  await expect(new AgentStorage(root, pino({ level: "silent" })).initialize()).rejects.toThrow(
    "does not match",
  );
  expect(await fs.readFile(path.join(directory, "session.json"), "utf8")).toContain("someone-else");
  await fs.writeFile(
    sessionDeletionIntentPath(directory),
    JSON.stringify({ version: 1, target: "../escape" }),
  );
  await expect(new AgentStorage(root, pino({ level: "silent" })).initialize()).rejects.toThrow(
    "identity",
  );
  expect(await fs.readFile(path.join(directory, "session.json"), "utf8")).toContain("someone-else");
});

it("releases completed deletion owners while fencing stale writes across cwd changes and restart", async () => {
  const root = await temporary();
  const storage = new AgentStorage(root, pino({ level: "silent" }), { sessionLayout: true });
  for (let index = 0; index < 32; index += 1) {
    const value = record(`deleted-${index}`);
    await storage.upsert(value);
    await storage.remove(value.id);
    expect(storage.activeDeletionCount).toBe(0);
    await expect(storage.upsert({ ...value, cwd: "/work/different" })).rejects.toThrow(
      "permanently deleted",
    );
  }
  expect(await storage.list()).toEqual([]);
  const reopened = new AgentStorage(root, pino({ level: "silent" }), { sessionLayout: true });
  expect(await reopened.list()).toEqual([]);
  await expect(reopened.upsert({ ...record("deleted-0"), cwd: "/work/third" })).rejects.toThrow(
    "permanently deleted",
  );
  expect(reopened.activeDeletionCount).toBe(0);
  await reopened.upsert(record("new-agent"));
  expect((await reopened.list()).map((value) => value.id)).toEqual(["new-agent"]);
});

it("reconstructs the permanent ID fence when restarting after the scoped intent alone", async () => {
  const root = await temporary();
  const storage = new AgentStorage(root, pino({ level: "silent" }), { sessionLayout: true });
  await storage.upsert(record("agent"));
  const directory = await storage.getSessionDirectory("agent");
  await writeSessionDeletionIntent(directory, {
    agentRoot: root,
    paths: [path.join(directory, "session.json")],
  });
  await expect(assertAgentNotDeleted(root, "agent")).resolves.toBeUndefined();
  expect(await new AgentStorage(root, pino({ level: "silent" })).list()).toEqual([]);
  await expect(assertAgentNotDeleted(root, "agent")).rejects.toThrow("permanently deleted");
});
