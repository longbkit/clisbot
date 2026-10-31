// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubApiError } from "./api-client";
import { HubUnreachableError } from "./transport/request-deadline";

const ORIGIN = "https://company.example.test";

const state = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  /** Hosts with a registered ticket resolver (a mounted Hub binding). */
  bound: new Set<string>(),
  /** What `GET daemons` does next. */
  list: { kind: "ok" as "ok" | "unreachable" | "forbidden", daemonIds: ["build-01"] },
  /** null = the account state could not be read (Hub unreachable). */
  accountState: null as null | "active" | "signedOut",
  hosts: [] as Array<{
    serverId: string;
    management: {
      kind: "hub";
      hubOrigin: string;
      organizationId: string;
      daemonId: string;
      managedAccessMode: "external";
    };
  }>,
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => state.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => void state.storage.set(key, value),
    removeItem: async (key: string) => void state.storage.delete(key),
  },
}));

function daemon(id: string) {
  return {
    id,
    slug: id,
    status: "active",
    presence: "online",
    connectedAt: null,
    lastSeenAt: "2026-10-25T00:00:00Z",
    canManage: false,
    managedAccessMode: "external",
    connectionOffer: {
      v: 2,
      serverId: `srv-${id}`,
      daemonPublicKeyB64: "key",
      relay: { endpoint: "relay.example.test", useTls: true },
    },
  };
}

function account() {
  const signedIn =
    state.accountState === "active"
      ? { account: { id: "acct" }, organization: { id: "org" } }
      : null;
  return {
    enabled: true,
    origin: ORIGIN,
    loading: false,
    error: null,
    state: state.accountState === null ? null : { status: state.accountState },
    signedIn,
    refresh: async () => undefined,
    api: () => ({
      get: async () => {
        if (state.list.kind === "unreachable") throw new HubUnreachableError("offline");
        if (state.list.kind === "forbidden") throw new HubApiError(403, "forbidden", "Forbidden");
        return { daemons: state.list.daemonIds.map(daemon) };
      },
    }),
  };
}

vi.mock("./account-provider", () => ({
  useHubAccount: () => account(),
  useHubAccounts: () => [account()],
  HubAccountScope: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => state.hosts,
  useHostRuntimeConnectedServerIds: () => [],
  getHostRuntimeStore: () => ({
    getHosts: () => state.hosts,
    removeManagedHost: async () => true,
    upsertManagedConnectionFromOffer: async ({ offer }: { offer: { serverId: string } }) => ({
      serverId: offer.serverId,
    }),
    adoptHostConnection: async () => undefined,
    whenHostRegistryLoaded: async () => undefined,
    markColdStartPhase: () => undefined,
  }),
}));
vi.mock("@/runtime/host-session-access", () => ({
  registerHostAccessTicketResolver: (serverId: string) => {
    state.bound.add(serverId);
    return () => state.bound.delete(serverId);
  },
}));

const { useHostInventory } = await import("./host-inventory");
const { HubHostSynchronization } = await import("./host-synchronization");
const { getHubDaemonListCache, HubDaemonListCache, cachedListForAccount } =
  await import("./hub-daemon-list-cache");

function managedHost(daemonId: string) {
  return {
    serverId: `srv-${daemonId}`,
    management: {
      kind: "hub" as const,
      hubOrigin: ORIGIN,
      organizationId: "org",
      daemonId,
      managedAccessMode: "external" as const,
    },
  };
}

function Probe() {
  const inventory = useHostInventory();
  return (
    <div data-testid="probe">
      {JSON.stringify({
        hosts: inventory.hosts.map((host) => host.serverId).sort(),
        status: inventory.status,
        lastSyncedAt: inventory.lastSyncedAtByOrigin.get(ORIGIN) ?? null,
      })}
    </div>
  );
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  return () => JSON.parse(view.getByTestId("probe").textContent ?? "{}");
}

function remembered(daemonIds: string[], syncedAt = "2026-10-25T09:00:00.000Z") {
  getHubDaemonListCache().remember({
    origin: ORIGIN,
    accountId: "acct",
    organizationId: "org",
    daemons: daemonIds.map(daemon) as never,
    syncedAt,
  });
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.storage.clear();
  state.bound.clear();
  state.list = { kind: "ok", daemonIds: ["build-01"] };
  state.accountState = "active";
  state.hosts = [managedHost("build-01"), managedHost("build-02")];
  Reflect.deleteProperty(globalThis, "__clisbotHubDaemonListCache");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Hub Hosts while the Hub is unreachable", () => {
  it("keeps showing the last listed Hosts with the time they were synced", async () => {
    remembered(["build-01", "build-02"]);
    state.accountState = null;
    state.list = { kind: "unreachable", daemonIds: [] };
    const probe = renderProbe();
    await waitFor(() =>
      expect(probe()).toEqual({
        hosts: ["srv-build-01", "srv-build-02"],
        status: "ready",
        lastSyncedAt: "2026-10-25T09:00:00.000Z",
      }),
    );
  });

  it("keeps showing them when the account is known but the list request fails", async () => {
    remembered(["build-01"]);
    state.list = { kind: "unreachable", daemonIds: [] };
    const probe = renderProbe();
    await waitFor(() => expect(probe().hosts).toEqual(["srv-build-01"]));
    expect(
      getHubDaemonListCache()
        .get(ORIGIN)
        ?.daemons.map(({ id }) => id),
    ).toEqual(["build-01"]);
  });

  it("hides them, as before, when nothing was ever synced", async () => {
    state.accountState = null;
    const probe = renderProbe();
    await waitFor(() => expect(probe()).toMatchObject({ hosts: [], lastSyncedAt: null }));
  });

  it("replaces the remembered list with a fresh one, so a delisted Host disappears", async () => {
    remembered(["build-01", "build-02"]);
    const probe = renderProbe();
    await waitFor(() => expect(probe()).toMatchObject({ hosts: ["srv-build-01"] }));
    expect(probe().lastSyncedAt).toBeNull();
    await act(() => getHubDaemonListCache().flush());
    const stored = JSON.parse(state.storage.get("@clisbot:hub-daemon-lists:v1") ?? "{}") as {
      lists: { daemons: { id: string }[] }[];
    };
    const storedIds = stored.lists.flatMap((list) => list.daemons).map((entry) => entry.id);
    expect(storedIds).toEqual(["build-01"]);
  });

  it("forgets the remembered list on an explicit 403", async () => {
    remembered(["build-01", "build-02"]);
    state.list = { kind: "forbidden", daemonIds: [] };
    const probe = renderProbe();
    await waitFor(() => expect(getHubDaemonListCache().get(ORIGIN)).toBeUndefined());
    expect(probe().hosts).toEqual([]);
    await act(() => getHubDaemonListCache().flush());
    expect(state.storage.has("@clisbot:hub-daemon-lists:v1")).toBe(false);
  });

  it("forgets the remembered list when the reachable Hub says the account signed out", async () => {
    remembered(["build-01"]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={client}>
        <HubHostSynchronization />
      </QueryClientProvider>
    );
    state.accountState = null;
    state.list = { kind: "unreachable", daemonIds: [] };
    const view = render(tree());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(getHubDaemonListCache().get(ORIGIN)?.accountId).toBe("acct");
    // Before the Hub answers, the remembered list binds its Hosts so they connect at once.
    expect([...state.bound]).toEqual(["srv-build-01"]);

    state.accountState = "signedOut";
    view.rerender(tree());
    await waitFor(() => expect(getHubDaemonListCache().get(ORIGIN)).toBeUndefined());
    expect([...state.bound]).toEqual([]);
  });

  it("does not show another account's list or a list the Hub signed out of", () => {
    const list = {
      origin: ORIGIN,
      accountId: "acct",
      organizationId: "org",
      daemons: [],
      syncedAt: "2026-10-25T09:00:00.000Z",
    };
    const signedIn = (accountId: string, organizationId: string) => ({
      state: {},
      signedIn: { account: { id: accountId }, organization: { id: organizationId } },
    });
    expect(cachedListForAccount(list, { state: null, signedIn: null })).toBe(list);
    expect(cachedListForAccount(list, signedIn("acct", "org"))).toBe(list);
    expect(cachedListForAccount(list, signedIn("other", "org"))).toBeUndefined();
    expect(cachedListForAccount(list, signedIn("acct", "other-org"))).toBeUndefined();
    expect(cachedListForAccount(list, { state: { status: "signedOut" }, signedIn: null })).toBe(
      undefined,
    );
  });
});

describe("HubDaemonListCache", () => {
  it("restores lists after a restart and keeps a newer list remembered while loading", async () => {
    const storage = new Map<string, string>();
    const backing = {
      getItem: async (key: string) => storage.get(key) ?? null,
      setItem: async (key: string, value: string) => void storage.set(key, value),
      removeItem: async (key: string) => void storage.delete(key),
    };
    const first = new HubDaemonListCache(backing);
    await first.load();
    first.remember({
      origin: ORIGIN,
      accountId: "acct",
      organizationId: "org",
      daemons: [daemon("build-01")] as never,
      syncedAt: "2026-10-25T09:00:00.000Z",
    });
    first.remember({
      origin: "https://other.example.test",
      accountId: "acct",
      organizationId: "org",
      daemons: [],
      syncedAt: "2026-10-25T09:00:00.000Z",
    });
    await first.flush();

    const restarted = new HubDaemonListCache(backing);
    const loading = restarted.load();
    restarted.remember({
      origin: ORIGIN,
      accountId: "acct",
      organizationId: "org",
      daemons: [],
      syncedAt: "2026-10-25T10:00:00.000Z",
    });
    await loading;
    expect(restarted.get(ORIGIN)?.syncedAt).toBe("2026-10-25T10:00:00.000Z");
    expect(restarted.get("https://other.example.test")?.syncedAt).toBe("2026-10-25T09:00:00.000Z");
    restarted.forget(ORIGIN);
    restarted.forget("https://other.example.test");
    await restarted.flush();
    expect(storage.size).toBe(0);
  });

  it("drops a corrupt stored value instead of showing it", async () => {
    const storage = new Map([["@clisbot:hub-daemon-lists:v1", '{"lists":[{"origin":1}]}']]);
    const cache = new HubDaemonListCache({
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => void storage.set(key, value),
      removeItem: async (key) => void storage.delete(key),
    });
    await cache.load();
    expect(cache.get(ORIGIN)).toBeUndefined();
    expect(storage.size).toBe(0);
  });
});
