import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { AgentStorage, type StoredAgentRecord } from "../agent-storage.js";
import type { AgentManager } from "../agent-manager.js";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";
import { recoverStoredSessionAuthorship } from "./recover-session-authorship.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** One stored agent whose log has no index: the startup probe marks its authorship pending. */
async function createUnindexedSession(agentId: string) {
  const root = await mkdtemp(path.join(tmpdir(), "recover-authorship-"));
  roots.push(root);
  const storage = new AgentStorage(path.join(root, "agents"), createTestLogger(), {
    sessionLayout: true,
  });
  await storage.upsert({
    id: agentId,
    provider: "codex",
    cwd: path.join(root, "project"),
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    labels: {},
    lastStatus: "closed",
  } as StoredAgentRecord);
  await writeFile(path.join(await storage.getSessionDirectory(agentId), "events.jsonl"), "{}\n");
  const timeline = new FileAgentTimelineStore((id) => storage.getSessionDirectory(id));
  const manager = { applySessionAuthorship: vi.fn() } as unknown as AgentManager;
  return { storage, timeline, manager };
}

const status = async (storage: AgentStorage, agentId: string) =>
  (await storage.get(agentId))?.authorshipStatus;

describe("recoverStoredSessionAuthorship", () => {
  it("probes every record at startup without cold storage", async () => {
    const { storage, timeline, manager } = await createUnindexedSession("agent-warm");
    expect(await recoverStoredSessionAuthorship(storage, timeline, manager)).toBeNull();
    expect(await status(storage, "agent-warm")).toBe("pending");
  });

  it("defers a cold record until its first history open", async () => {
    const { storage, timeline, manager } = await createUnindexedSession("agent-cold");
    const probes = await recoverStoredSessionAuthorship(storage, timeline, manager, {
      isCold: () => true,
      logger: createTestLogger(),
    });
    expect(probes?.size).toBe(1);
    expect(await status(storage, "agent-cold")).toBeUndefined();

    await timeline.getEpoch("agent-cold").catch(() => undefined);
    expect(await status(storage, "agent-cold")).toBe("pending");
    expect(probes?.size).toBe(0);
  });

  it("probes the cold records left over in the background drain", async () => {
    const { storage, timeline, manager } = await createUnindexedSession("agent-idle");
    const probes = await recoverStoredSessionAuthorship(storage, timeline, manager, {
      isCold: () => true,
      logger: createTestLogger(),
    });
    await probes?.drain((agentId, probe) => timeline.exclusive(agentId, probe));
    expect(await status(storage, "agent-idle")).toBe("pending");
  });
});
