import { describe, expect, it } from "vitest";
import { ReplicaCache } from ".";
import {
  FLEET_AGENTS_PER_HOST,
  FLEET_ROWS_PER_HOST,
  cachedFleetStorage,
  fleetServerId,
} from "./cached-fleet-fixture";
import { RESTORE_ROWS_PER_CHUNK, RestoreSlicer, type RestoreChunk } from "./restore-slicer";

function slicer() {
  const chunks: RestoreChunk[] = [];
  const order: string[] = [];
  let yields = 0;
  const subject = new RestoreSlicer({
    now: () => 0,
    yieldToEventLoop: async () => {
      yields += 1;
      order.push("yield");
    },
    onChunk: (chunk) => {
      chunks.push(chunk);
      order.push(`chunk:${chunk.rows}`);
    },
  });
  return { subject, chunks, order, yields: () => yields };
}

describe("reading a cached directory in chunks", () => {
  it("parses at most 100 rows per chunk and yields between chunks", async () => {
    const serverId = fleetServerId(0);
    const storage = await cachedFleetStorage([serverId]);
    const cache = new ReplicaCache(storage, { clearLegacyCache: async () => undefined });
    cache.setHosts([serverId]);
    const { subject, chunks, order, yields } = slicer();

    const directory = await cache.readDirectory(serverId, subject);
    subject.end();

    expect(directory.agents.size).toBe(FLEET_AGENTS_PER_HOST);
    const fullChunks = Math.floor(FLEET_ROWS_PER_HOST / RESTORE_ROWS_PER_CHUNK);
    expect(chunks.map((chunk) => chunk.rows)).toEqual([
      ...Array.from({ length: fullChunks }, () => RESTORE_ROWS_PER_CHUNK),
      FLEET_ROWS_PER_HOST % RESTORE_ROWS_PER_CHUNK,
    ]);
    // Every full chunk is followed by a yield before the next row is parsed.
    expect(yields()).toBe(fullChunks);
    expect(order.slice(0, 4)).toEqual(["chunk:100", "yield", "chunk:100", "yield"]);
  });

  it("reads in one pass when no slicer is given", async () => {
    const serverId = fleetServerId(0);
    const storage = await cachedFleetStorage([serverId]);
    const cache = new ReplicaCache(storage, { clearLegacyCache: async () => undefined });
    cache.setHosts([serverId]);

    const directory = await cache.readDirectory(serverId);

    expect(directory.agents.size).toBe(FLEET_AGENTS_PER_HOST);
  });
});
