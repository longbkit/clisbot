import { describe, expect, it, vi } from "vitest";
import type { AgentSnapshotPayload } from "../messages.js";
import { AgentDirectory } from "./directory.js";
import type { StoredAgentRecord } from "./agent-storage.js";

function storedRecord(id: string, title: string): StoredAgentRecord {
  return {
    id,
    provider: "codex",
    cwd: "/tmp/project",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    title,
    labels: {},
    lastStatus: "closed",
  } as StoredAgentRecord;
}

function createDirectory(records: StoredAgentRecord[], projectionKey?: () => string) {
  const projectStored = vi.fn(
    (record: StoredAgentRecord) =>
      ({ id: record.id, provider: record.provider, title: record.title }) as AgentSnapshotPayload,
  );
  const directory = new AgentDirectory({
    manager: { listAgents: () => [] },
    storage: { list: async () => records },
    workspaces: { get: async () => null, list: async () => [] },
    projectLive: async () => {
      throw new Error("no live agents");
    },
    projectStored,
    ...(projectionKey ? { storedProjectionKey: projectionKey } : {}),
    isProviderVisible: () => true,
    isStoredProviderAvailable: () => true,
  });
  return { directory, projectStored };
}

describe("AgentDirectory stored projection cache", () => {
  it("projects every stored record on every list without a projection key", async () => {
    const { directory, projectStored } = createDirectory([storedRecord("a", "one")]);
    await directory.list();
    await directory.list();
    expect(projectStored).toHaveBeenCalledTimes(2);
  });

  it("reuses the payload of an unchanged record and re-projects a replaced one", async () => {
    const records = [storedRecord("a", "one"), storedRecord("b", "two")];
    const { directory, projectStored } = createDirectory(records, () => "codex");
    await directory.list();
    await directory.list();
    expect(projectStored).toHaveBeenCalledTimes(2);

    records[0] = { ...records[0]!, title: "renamed" };
    const listed = await directory.list();
    expect(projectStored).toHaveBeenCalledTimes(3);
    expect(listed.find((agent) => agent.id === "a")?.title).toBe("renamed");
  });

  it("re-projects every record when the projection key changes", async () => {
    let key = "codex";
    const { directory, projectStored } = createDirectory([storedRecord("a", "one")], () => key);
    await directory.list();
    key = "codex\nclaude";
    await directory.list();
    expect(projectStored).toHaveBeenCalledTimes(2);
  });

  it("hands out copies, so a caller's edit never reaches the cached payload", async () => {
    const { directory } = createDirectory([storedRecord("a", "one")], () => "codex");
    const [first] = await directory.list();
    first!.title = "edited by a caller";
    const [second] = await directory.list();
    expect(second?.title).toBe("one");
  });
});
