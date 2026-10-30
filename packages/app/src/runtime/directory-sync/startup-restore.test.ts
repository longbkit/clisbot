import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplicaCache, type CachedDirectory } from "@/runtime/replica-cache";
import {
  FLEET_AGENTS_PER_HOST,
  FLEET_HOSTS,
  FLEET_ROWS_PER_HOST,
  cachedFleetStorage,
  fleetServerIds,
} from "@/runtime/replica-cache/cached-fleet-fixture";
import {
  RESTORE_ROWS_PER_CHUNK,
  RestoreSlicer,
  yieldToEventLoop,
  type RestoreChunk,
} from "@/runtime/replica-cache/restore-slicer";
import { restoreCachedDirectories, type StartupRestoreTarget } from "./startup-restore";

/** Records, in order, what the restore did and what else got the JS thread in between. */
function harness(cache: ReplicaCache, events: string[] = []) {
  const chunks: RestoreChunk[] = [];
  const loads: Array<Promise<void>> = [];
  const applied = new Map<string, number>();
  const targets: StartupRestoreTarget[] = fleetServerIds().map((serverId) => ({
    serverId,
    directory: {
      adoptCacheRestore: (restored) => {
        loads.push(restored.then(() => void events.push(`load:${serverId}`)));
      },
      cacheReadRevision: () => 0,
      applyCachedDirectory: (cached: CachedDirectory) => {
        applied.set(serverId, cached.agents.size);
        events.push(`apply:${serverId}`);
      },
    },
  }));
  const yieldAndRecord = async () => {
    events.push("yield");
    await yieldToEventLoop();
  };
  const slicer = new RestoreSlicer({
    now: Date.now,
    yieldToEventLoop: yieldAndRecord,
    onChunk: (chunk) => chunks.push(chunk),
  });
  const run = restoreCachedDirectories(targets, {
    read: (serverId, chunked) => {
      events.push(`read:${serverId}`);
      return cache.readDirectory(serverId, chunked);
    },
    slicer,
    yieldToEventLoop: yieldAndRecord,
    commit: (apply) => {
      events.push("commit");
      apply();
    },
    afterNextFrame: (paint) => setTimeout(paint, 16),
    onFirstCachedFrame: () => events.push("first-cached-frame"),
  });
  return { events, chunks, loads, applied, run };
}

describe("restoring the cached directories of 14 Hosts at startup", () => {
  let cache: ReplicaCache;

  beforeEach(async () => {
    const storage = await cachedFleetStorage();
    cache = new ReplicaCache(storage, { clearLegacyCache: async () => undefined });
    cache.setHosts(fleetServerIds());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets work queued at startup run before reading anything", async () => {
    const events: string[] = [];
    // A connect or Hub request issued just before the restore starts, as the controllers' are.
    setTimeout(() => events.push("network"), 0);
    const { run } = harness(cache, events);

    await vi.runAllTimersAsync();
    await run;

    expect(events.slice(0, 3)).toEqual(["yield", "network", `read:${fleetServerIds()[0]}`]);
  });

  it("parses at most 100 rows per chunk and yields between chunks and Hosts", async () => {
    const { events, chunks, run } = harness(cache);
    await vi.runAllTimersAsync();
    await run;

    const rowChunks = chunks.filter((chunk) => chunk.rows > 0);
    expect(Math.max(...rowChunks.map((chunk) => chunk.rows))).toBe(RESTORE_ROWS_PER_CHUNK);
    expect(rowChunks.reduce((sum, chunk) => sum + chunk.rows, 0)).toBe(
      FLEET_HOSTS * FLEET_ROWS_PER_HOST,
    );
    const chunksPerHost = Math.ceil(FLEET_ROWS_PER_HOST / RESTORE_ROWS_PER_CHUNK);
    // Row chunks, plus the two commits.
    expect(chunks).toHaveLength(FLEET_HOSTS * chunksPerHost + 2);
    // Network answers get the thread between Hosts: the next Host is read only after a yield.
    const reads = events.flatMap((event, index) => (event.startsWith("read:") ? [index] : []));
    for (let host = 1; host < FLEET_HOSTS; host += 1) {
      expect(events.slice(reads[host - 1]!, reads[host]!)).toContain("yield");
    }
  });

  it("commits the first Host alone, then every other Host in one commit", async () => {
    const { events, applied, run } = harness(cache);

    await vi.runAllTimersAsync();
    await run;

    const [first, ...rest] = fleetServerIds();
    const commits = events.flatMap((event, index) => (event === "commit" ? [index] : []));
    expect(commits).toHaveLength(2);
    expect(events.slice(commits[0]! + 1, commits[0]! + 2)).toEqual([`apply:${first}`]);
    expect(events.slice(commits[1]! + 1, commits[1]! + 1 + rest.length)).toEqual(
      rest.map((serverId) => `apply:${serverId}`),
    );
    // The first commit comes before any other Host is read.
    expect(commits[0]!).toBeLessThan(events.indexOf(`read:${rest[0]}`));
    expect([...applied.values()]).toEqual(
      Array.from({ length: FLEET_HOSTS }, () => FLEET_AGENTS_PER_HOST),
    );
    // The frame after the first commit is the first cached frame.
    expect(events.indexOf("first-cached-frame")).toBeGreaterThan(commits[0]!);
  });

  it("holds every other load of a Host's cache until its restore is committed", async () => {
    const { events, loads, run } = harness(cache);

    await vi.runAllTimersAsync();
    await run;
    await Promise.all(loads);

    const [first, last] = [fleetServerIds()[0]!, fleetServerIds().at(-1)!];
    expect(loads).toHaveLength(FLEET_HOSTS);
    expect(events.indexOf(`load:${first}`)).toBeGreaterThan(events.indexOf(`apply:${first}`));
    expect(events.indexOf(`load:${last}`)).toBeGreaterThan(events.indexOf(`apply:${last}`));
  });
});
