import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultHostAppearance } from "@/hosts/appearance";
import { projectDirectoryHealth } from "@/hooks/use-directory-health";
import { summarizeSourceHealth } from "@/hooks/use-source-health";
import type { HubSourceHealth } from "@/clisbot/hub/hub-source-health";
import type { HostProfile } from "@/types/host-connection";
import type { HostRuntimeSnapshot } from "./host-runtime";
import {
  nextShownState,
  SOURCE_DEGRADED_DEBOUNCE_MS,
  SourceHealthStore,
  type SourceHealthRuntime,
} from "./source-health";

vi.mock("@/runtime/host-runtime", () => ({ getHostRuntimeStore: () => null }));

const HUB = "https://company.example.test";

function host(index: number, hubOrigin: string | null = HUB): HostProfile {
  return {
    serverId: `srv-${index}`,
    label: `sandbox-${String(index).padStart(3, "0")}`,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    createdAt: "2026-10-25",
    updatedAt: "2026-10-25",
    preferredConnectionId: "direct",
    connections: [{ id: "direct", type: "directTcp", endpoint: `sandbox-${index}:6767` }],
    ...(hubOrigin
      ? {
          management: {
            kind: "hub" as const,
            hubOrigin,
            organizationId: "org",
            daemonId: `daemon-${index}`,
            managedAccessMode: "external" as const,
          },
        }
      : {}),
  };
}

function snapshot(serverId: string, patch: Partial<HostRuntimeSnapshot> = {}): HostRuntimeSnapshot {
  return {
    serverId,
    activeConnectionId: "direct",
    activeConnection: null,
    connectionStatus: "online",
    client: null,
    lastError: null,
    authFailureReason: null,
    lastOnlineAt: null,
    agentDirectoryStatus: "ready",
    agentDirectoryError: null,
    hasEverLoadedAgentDirectory: true,
    workspaceDirectoryStatus: "ready",
    workspaceDirectoryError: null,
    hasEverLoadedWorkspaceDirectory: true,
    probeByConnectionId: new Map(),
    clientGeneration: 1,
    connectionEpoch: 1,
    ...patch,
  };
}

/** A runtime with the store's narrow interface: per-Host events, like the real one. */
function fakeRuntime(initialHosts: HostProfile[]) {
  let hosts = initialHosts;
  const hostListListeners = new Set<() => void>();
  const snapshots = new Map(initialHosts.map((h) => [h.serverId, snapshot(h.serverId)]));
  const listeners = new Map<string, Set<() => void>>();
  let subscribeCalls = 0;
  const runtime: SourceHealthRuntime = {
    getHosts: () => hosts,
    getSnapshot: (serverId) => snapshots.get(serverId) ?? null,
    subscribe: (serverId, listener) => {
      subscribeCalls += 1;
      const set = listeners.get(serverId) ?? new Set();
      set.add(listener);
      listeners.set(serverId, set);
      return () => set.delete(listener);
    },
    subscribeHostList: (listener) => {
      hostListListeners.add(listener);
      return () => hostListListeners.delete(listener);
    },
  };
  return {
    runtime,
    setHosts(next: HostProfile[]) {
      hosts = next;
      for (const listener of hostListListeners) listener();
    },
    activeListeners: () =>
      [...listeners.values()].reduce((total, set) => total + set.size, 0) + hostListListeners.size,
    set(serverId: string, patch: Partial<HostRuntimeSnapshot>) {
      snapshots.set(serverId, { ...snapshots.get(serverId)!, ...patch });
      for (const listener of listeners.get(serverId) ?? []) listener();
    },
    subscribeCalls: () => subscribeCalls,
  };
}

const liveHub: HubSourceHealth = {
  origin: HUB,
  label: "Company",
  state: "live",
  lastSyncedAt: "2026-10-25T10:00:00.000Z",
};

describe("nextShownState", () => {
  it("shows a degraded state only after the debounce and leaves it only when online again", () => {
    expect(nextShownState({ shown: "live", raw: "offline", degradedFor: 2_999 })).toBe("live");
    expect(nextShownState({ shown: "live", raw: "offline", degradedFor: 3_000 })).toBe("offline");
    expect(nextShownState({ shown: null, raw: "offline", degradedFor: 0 })).toBe("syncing");
    // A retry attempt ("connecting") does not flip an offline source back.
    expect(nextShownState({ shown: "offline", raw: "syncing", degradedFor: 0 })).toBe("offline");
    expect(nextShownState({ shown: "offline", raw: "live", degradedFor: 0 })).toBe("live");
    expect(nextShownState({ shown: "offline", raw: "needs-sign-in", degradedFor: 0 })).toBe(
      "needs-sign-in",
    );
  });
});

describe("SourceHealthStore", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => vi.useRealTimers());

  it("debounces a blip and never publishes an unchanged entry", () => {
    const fake = fakeRuntime([host(1)]);
    const store = new SourceHealthStore(fake.runtime);
    const entry = store.get("srv-1");
    expect(entry?.state).toBe("live");
    const notified = vi.fn();
    store.subscribeSource("srv-1", notified);

    fake.set("srv-1", { lastError: null });
    expect(store.get("srv-1")).toBe(entry);
    expect(notified).not.toHaveBeenCalled();

    fake.set("srv-1", { connectionStatus: "offline" });
    vi.advanceTimersByTime(SOURCE_DEGRADED_DEBOUNCE_MS - 1);
    expect(store.get("srv-1")?.state).toBe("live");
    fake.set("srv-1", { connectionStatus: "online" });
    vi.advanceTimersByTime(SOURCE_DEGRADED_DEBOUNCE_MS);
    expect(store.get("srv-1")?.state).toBe("live");

    fake.set("srv-1", { connectionStatus: "error", lastError: "Transport closed" });
    vi.advanceTimersByTime(SOURCE_DEGRADED_DEBOUNCE_MS);
    expect(store.get("srv-1")).toMatchObject({ state: "offline", error: "Transport closed" });
    expect(store.get("srv-1")?.lastSyncedAt).not.toBeNull();
    store.dispose();
  });

  it("keeps 99 sources live and touches only the failed one when 1 of 100 drops", () => {
    const hosts = Array.from({ length: 100 }, (_, index) => host(index));
    const fake = fakeRuntime(hosts);
    const store = new SourceHealthStore(fake.runtime);
    const before = store.getEntries();
    const versionBefore = store.getVersion();
    const otherListener = vi.fn();
    store.subscribeSource("srv-1", otherListener);

    fake.set("srv-42", { connectionStatus: "error", lastError: "unreachable" });
    vi.advanceTimersByTime(SOURCE_DEGRADED_DEBOUNCE_MS);

    const after = store.getEntries();
    // The drop itself (connection flag, error), then the debounced offline state.
    expect(store.getVersion()).toBe(versionBefore + 2);
    expect(after.filter((entry, index) => entry !== before[index]).map((e) => e.serverId)).toEqual([
      "srv-42",
    ]);
    expect(otherListener).not.toHaveBeenCalled();
    expect(fake.subscribeCalls()).toBe(100);

    const summary = summarizeSourceHealth(after, [liveHub]);
    expect(summary).toMatchObject({ total: 100, reachable: 99, live: 99, offline: 1 });
    expect(summary.hubs).toEqual([{ ...liveHub, reachable: 99, total: 100 }]);
    expect(summary.degraded.map((s) => [s.serverId, s.problem])).toEqual([
      ["srv-42", "host-unreachable"],
    ]);

    const health = projectDirectoryHealth(after, [liveHub], "agents");
    expect(health).toEqual({
      hasAcceptedResult: true,
      degraded: { serverIds: ["srv-42"], total: 100 },
      status: "ready",
      message: null,
      serverId: null,
    });
    store.dispose();
  });

  it("is unavailable only when no selected source can refresh", () => {
    const fake = fakeRuntime([host(1), host(2)]);
    const store = new SourceHealthStore(fake.runtime);
    fake.set("srv-1", { connectionStatus: "error", lastError: "offline" });
    fake.set("srv-2", { connectionStatus: "error", lastError: "offline" });
    vi.advanceTimersByTime(SOURCE_DEGRADED_DEBOUNCE_MS);
    const unreachableHub = { ...liveHub, state: "unreachable" as const };
    expect(projectDirectoryHealth(store.getEntries(), [unreachableHub], "agents")).toEqual({
      hasAcceptedResult: true,
      status: "unavailable",
      serverId: "srv-1",
      recovery: "connection",
      message:
        "sandbox-001: Company is unreachable. If it is reached over a VPN, check that connection.",
    });
    store.dispose();
  });

  it("loads only while no source has anything to show, and never for one slow source", () => {
    const fake = fakeRuntime([host(1), host(2)]);
    const store = new SourceHealthStore(fake.runtime);
    fake.set("srv-2", {
      connectionStatus: "connecting",
      agentDirectoryStatus: "idle",
      hasEverLoadedAgentDirectory: false,
    });
    expect(projectDirectoryHealth(store.getEntries(), [], "agents")).toMatchObject({
      status: "ready",
      hasAcceptedResult: false,
    });
    fake.set("srv-1", {
      connectionStatus: "connecting",
      agentDirectoryStatus: "idle",
      hasEverLoadedAgentDirectory: false,
    });
    expect(projectDirectoryHealth(store.getEntries(), [], "agents").status).toBe("loading");
    store.dispose();
  });

  it("lets the Hub's sign-in or revocation answer override its unreachable Hosts", () => {
    const fake = fakeRuntime([host(1), host(2), host(3, null)]);
    const store = new SourceHealthStore(fake.runtime);
    for (const id of ["srv-1", "srv-3"]) fake.set(id, { connectionStatus: "error" });
    vi.advanceTimersByTime(SOURCE_DEGRADED_DEBOUNCE_MS);
    const signIn = summarizeSourceHealth(store.getEntries(), [
      { ...liveHub, state: "needs-sign-in" },
    ]);
    expect(signIn.degraded.map((s) => [s.serverId, s.effectiveState, s.problem])).toEqual([
      ["srv-1", "needs-sign-in", "hub-sign-in"],
      ["srv-3", "offline", "host-unreachable"],
    ]);
    // A Host that is still reachable stays live whatever its Hub reports.
    expect(signIn.live).toBe(1);
    const revoked = summarizeSourceHealth(store.getEntries(), [{ ...liveHub, state: "revoked" }]);
    expect(revoked.revoked).toBe(1);
    store.dispose();
  });
});

describe("SourceHealthStore resource bounds (acceptance P7)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => vi.useRealTimers());

  it("holds one listener per Host and returns to baseline when Hosts are removed", () => {
    const baselineTimers = vi.getTimerCount();
    const hosts = Array.from({ length: 100 }, (_, index) => host(index));
    const fake = fakeRuntime(hosts);
    const writes: string[] = [];
    const store = new SourceHealthStore(fake.runtime, {
      storage: { getItem: async () => null, setItem: async (_k, v) => void writes.push(v) },
    });
    // Ten simulated minutes: every Host flaps once a minute, 10 stay down.
    for (let minute = 0; minute < 10; minute += 1) {
      for (const [index, entry] of hosts.entries()) {
        const down = index % 10 === 3 || minute % 2 === 1;
        fake.set(entry.serverId, {
          connectionStatus: down ? "error" : "online",
          lastError: down ? "unreachable" : null,
        });
      }
      vi.advanceTimersByTime(60_000);
      expect(fake.activeListeners()).toBe(101);
      // At most the pending debounce per Host plus one persistence timer.
      expect(vi.getTimerCount() - baselineTimers).toBeLessThanOrEqual(101);
    }
    expect(store.getEntries()).toHaveLength(100);
    expect(writes.length).toBeLessThanOrEqual((10 * 60_000) / 5_000);

    fake.setHosts([]);
    expect(store.getEntries()).toHaveLength(0);
    expect(fake.activeListeners()).toBe(1);
    store.dispose();
    vi.advanceTimersByTime(10_000);
    expect(fake.activeListeners()).toBe(0);
    expect(vi.getTimerCount()).toBe(baselineTimers);
  });
});
