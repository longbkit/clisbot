// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceHealth } from "@/runtime/source-health";

const state = vi.hoisted(() => ({
  registered: [] as string[],
  registryLoaded: true,
  inventory: [] as string[],
  inventorySettled: true,
  daemonListsLoaded: true,
  entries: [] as unknown[],
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => state.registered.map((serverId) => ({ serverId })),
  useHostRegistryLoaded: () => state.registryLoaded,
}));
vi.mock("@/clisbot/hub/host-inventory", () => ({
  useHostInventory: () => ({
    hosts: state.inventory.map((serverId) => ({ serverId })),
    settled: state.inventorySettled,
  }),
}));
vi.mock("@/clisbot/hub/hub-daemon-list-cache", () => ({
  useHubDaemonListsLoaded: () => state.daemonListsLoaded,
}));
vi.mock("@/hooks/use-source-health", () => ({
  useSourceHealthEntries: () => state.entries,
  resolveSourceStatus: (entry: { state: string }) => ({ ...entry, effectiveState: entry.state }),
}));
vi.mock("@/clisbot/hub/hub-source-health", () => ({ useHubSourceHealth: () => [] }));

const { useSourceLiveness } = await import("./use-source-liveness");

const health = (serverId: string, overrides: Partial<SourceHealth> = {}): SourceHealth =>
  ({
    serverId,
    state: "live",
    online: true,
    agents: { loaded: true, syncing: false, pending: false, error: null },
    ...overrides,
  }) as SourceHealth;
const read = () => renderHook(() => useSourceLiveness()).result.current;

beforeEach(() => {
  Object.assign(state, {
    registered: ["own", "offline", "hidden"],
    registryLoaded: true,
    inventory: ["own", "offline"],
    inventorySettled: true,
    daemonListsLoaded: true,
    entries: [health("own"), health("offline", { state: "offline", online: false })],
  });
});

describe("the sources Navigation V2 may list and which of them are live", () => {
  it("lists what the picker lists and calls a registered, offline Host cached", () => {
    const { listable, cached } = read();
    expect([...listable].sort()).toEqual(["offline", "own"]);
    expect([...cached]).toEqual(["offline"]);
  });

  it("hides nothing before the registry has loaded", () => {
    state.registryLoaded = false;
    expect([...read().listable].sort()).toEqual(["hidden", "offline", "own"]);
  });

  it("hides nothing before every Hub has answered or the remembered lists have loaded", () => {
    state.inventorySettled = false;
    expect(read().listable.has("hidden")).toBe(true);
    state.inventorySettled = true;
    state.daemonListsLoaded = false;
    expect(read().listable.has("hidden")).toBe(true);
  });

  it("keeps a Host the picker keeps through a Hub that is only temporarily unavailable", () => {
    state.registered = ["own", "managed"];
    state.inventory = ["own", "managed"];
    state.entries = [health("own"), health("managed", { state: "offline", online: false })];
    const { listable, cached } = read();
    expect(listable.has("managed")).toBe(true);
    expect(cached.has("managed")).toBe(true);
  });

  it("does not take a Host with no health entry yet as live", () => {
    state.entries = [health("own")];
    expect([...read().cached].sort()).toEqual(["offline"]);
  });
});
