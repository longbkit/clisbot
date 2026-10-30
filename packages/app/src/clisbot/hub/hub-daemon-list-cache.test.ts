import { describe, expect, it } from "vitest";
import {
  HubDaemonListCache,
  type CachedHubDaemonList,
  type HubDaemonListStorage,
} from "./hub-daemon-list-cache";

function createMemoryStorage() {
  const items = new Map<string, string>();
  const storage: HubDaemonListStorage = {
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => {
      items.set(key, value);
    },
    removeItem: async (key) => {
      items.delete(key);
    },
  };
  return { storage, items };
}

function list(syncedAt: string, presence = "connected"): CachedHubDaemonList {
  return {
    origin: "https://hub.example",
    accountId: "acct",
    organizationId: "org",
    daemons: [
      {
        id: "daemon-1",
        slug: "build-01",
        status: "active",
        presence,
        connectedAt: null,
        lastSeenAt: "2026-10-30T00:00:00.000Z",
        canManage: false,
        connectionOffer: null,
        managedAccessMode: "external",
      },
    ],
    syncedAt,
  };
}

describe("HubDaemonListCache", () => {
  it("does not notify readers when a poll returns the same list, but keeps its sync time", async () => {
    const { storage, items } = createMemoryStorage();
    const cache = new HubDaemonListCache(storage);
    await cache.load();
    let notifications = 0;
    cache.subscribe(() => {
      notifications += 1;
    });

    cache.remember(list("2026-10-30T10:00:00.000Z"));
    cache.remember(list("2026-10-30T10:01:00.000Z"));
    await cache.flush();

    expect(notifications).toBe(1);
    expect(cache.get("https://hub.example")?.syncedAt).toBe("2026-10-30T10:01:00.000Z");
    expect(items.get("@clisbot:hub-daemon-lists:v1")).toContain("2026-10-30T10:01:00.000Z");
  });

  it("notifies readers when a daemon in the list changed", async () => {
    const cache = new HubDaemonListCache(createMemoryStorage().storage);
    await cache.load();
    let notifications = 0;
    cache.subscribe(() => {
      notifications += 1;
    });

    cache.remember(list("2026-10-30T10:00:00.000Z"));
    cache.remember(list("2026-10-30T10:01:00.000Z", "offline"));

    expect(notifications).toBe(2);
  });
});
