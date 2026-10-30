import { describe, expect, it } from "vitest";
import { ReplicaCache, STORED_INDEX_BYTES_PER_CHUNK } from ".";
import {
  FLEET_AGENTS_PER_HOST,
  cachedFleetStorage,
  fleetServerId,
  fleetServerIds,
} from "./cached-fleet-fixture";
import { MemoryStorage } from "./testing";

async function restoredHost() {
  const serverId = fleetServerId(0);
  const storage = await cachedFleetStorage([serverId]);
  const cache = new ReplicaCache(storage, { clearLegacyCache: async () => undefined });
  cache.setHosts([serverId]);
  const directory = await cache.readDirectory(serverId);
  const writesBefore = storage.changes.length;
  return { serverId, cache, directory, written: () => rowsWritten(storage, writesBefore) };
}

/** Row ids upserted and deleted by the writes after the first `skip`. */
function rowsWritten(storage: MemoryStorage, skip: number) {
  const changes = storage.changes.slice(skip);
  const upserted = changes.flatMap((change) => change.upserts);
  const deleted = changes.flatMap((change) => change.deletes);
  return { upserted: upserted.map((row) => row.id), deleted: deleted.map((row) => row.id) };
}

describe("the first save after launch", () => {
  it("measures the stored rows in chunks of at most 256 KB, yielding between them", async () => {
    const serverIds = fleetServerIds();
    const storage = await cachedFleetStorage(serverIds);
    const storedBytes = [...storage.rows.values()].reduce(
      (sum, row) => sum + row.payload.length,
      0,
    );
    let yields = 0;
    const cache = new ReplicaCache(storage, {
      clearLegacyCache: async () => undefined,
      yieldToEventLoop: async () => {
        yields += 1;
      },
    });
    cache.setHosts(serverIds);

    cache.commitDirectoryMutations(serverIds[0]!, [
      { kind: "agent", type: "delete", id: "agent-0" },
    ]);
    await cache.flush();

    expect(yields).toBe(Math.floor(storedBytes / STORED_INDEX_BYTES_PER_CHUNK));
    expect(await cache.usedBytes()).toBeGreaterThan(storedBytes - 1_000);
  });
});

describe("saving a directory baseline after a cache restore", () => {
  it("writes nothing when the live directory equals the cached one", async () => {
    const { serverId, cache, directory, written } = await restoredHost();

    cache.replaceDirectoryBaseline(serverId, directory);
    await cache.flush();

    expect(written()).toEqual({ upserted: [], deleted: [] });
  });

  it("writes only the rows that changed, and still deletes the rows the baseline dropped", async () => {
    const { serverId, cache, directory, written } = await restoredHost();
    const agents = new Map(directory.agents);
    const renamed = { ...agents.get("agent-0")!, title: "Renamed" };
    agents.set(renamed.id, renamed);
    agents.delete("agent-1");

    cache.replaceDirectoryBaseline(serverId, { ...directory, agents });
    await cache.flush();

    expect(written()).toEqual({ upserted: ["agent-0"], deleted: ["agent-1"] });
    const reread = await cache.readDirectory(serverId);
    expect(reread.agents.size).toBe(FLEET_AGENTS_PER_HOST - 1);
    expect(reread.agents.get("agent-0")?.title).toBe("Renamed");
  });
});
