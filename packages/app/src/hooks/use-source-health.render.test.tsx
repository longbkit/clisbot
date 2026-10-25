// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultHostAppearance } from "@/hosts/appearance";
import type { HostRuntimeSnapshot } from "@/runtime/host-runtime";
import { SOURCE_DEGRADED_DEBOUNCE_MS } from "@/runtime/source-health";
import type { HostProfile } from "@/types/host-connection";

/**
 * Acceptance P5: a health change on one of 100 Hosts re-renders only that Host's
 * `useSourceHealth` consumers (and summary readers), never the other 99.
 */
const fleet = vi.hoisted(() => ({
  hosts: [] as HostProfile[],
  snapshots: new Map<string, HostRuntimeSnapshot>(),
  listeners: new Map<string, Set<() => void>>(),
}));
const runtime = vi.hoisted(() => ({
  getHosts: () => fleet.hosts,
  getSnapshot: (serverId: string) => fleet.snapshots.get(serverId) ?? null,
  subscribe: (serverId: string, listener: () => void) => {
    const set = fleet.listeners.get(serverId) ?? new Set();
    set.add(listener);
    fleet.listeners.set(serverId, set);
    return () => set.delete(listener);
  },
  subscribeHostList: () => () => undefined,
}));
vi.mock("@/runtime/host-runtime", () => ({ getHostRuntimeStore: () => runtime }));

const { useSourceHealth, useSourceHealthSummary } = await import("./use-source-health");

const HOSTS = 100;
const renders = new Map<string, number>();
let summaryRenders = 0;

function count(key: string) {
  renders.set(key, (renders.get(key) ?? 0) + 1);
}

function Row({ serverId }: { serverId: string }) {
  const health = useSourceHealth(serverId);
  count(serverId);
  return <span data-testid={serverId}>{health?.effectiveState}</span>;
}

function Summary() {
  const summary = useSourceHealthSummary();
  summaryRenders += 1;
  return <span data-testid="summary">{`${summary.reachable}/${summary.total}`}</span>;
}

function snapshot(serverId: string): HostRuntimeSnapshot {
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
  };
}

function emit(serverId: string, patch: Partial<HostRuntimeSnapshot>) {
  fleet.snapshots.set(serverId, { ...fleet.snapshots.get(serverId)!, ...patch });
  for (const listener of fleet.listeners.get(serverId) ?? []) listener();
}

function otherRowRenders(except: string): number {
  let total = 0;
  for (const [key, value] of renders) if (key !== except) total += value;
  return total;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  Reflect.deleteProperty(globalThis, "__clisbotSourceHealthStore");
  fleet.hosts = Array.from({ length: HOSTS }, (_, index) => ({
    serverId: `srv-${index}`,
    label: `sandbox-${index}`,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    createdAt: "2026-10-25",
    updatedAt: "2026-10-25",
    preferredConnectionId: "direct",
    connections: [{ id: "direct", type: "directTcp", endpoint: `sandbox-${index}:6767` }],
  }));
  fleet.snapshots = new Map(fleet.hosts.map((host) => [host.serverId, snapshot(host.serverId)]));
  fleet.listeners.clear();
  renders.clear();
  summaryRenders = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("re-renders only the affected Host's consumers when 1 of 100 changes", () => {
  const view = render(
    <>
      {fleet.hosts.map((host) => (
        <Row key={host.serverId} serverId={host.serverId} />
      ))}
      <Summary />
    </>,
  );
  expect(view.getByTestId("summary").textContent).toBe("100/100");
  renders.clear();
  summaryRenders = 0;

  // 200 runtime events that change nothing a source shows: no React work at all.
  act(() => {
    for (let i = 0; i < 200; i += 1) emit("srv-1", { clientGeneration: i + 2 });
  });
  expect(otherRowRenders("")).toBe(0);
  expect(summaryRenders).toBe(0);

  // One Host drops and stays down past the debounce.
  act(() => emit("srv-42", { connectionStatus: "error", lastError: "unreachable" }));
  act(() => vi.advanceTimersByTime(SOURCE_DEGRADED_DEBOUNCE_MS));
  expect(view.getByTestId("srv-42").textContent).toBe("offline");
  expect(view.getByTestId("summary").textContent).toBe("99/100");
  // The drop itself, then the debounced offline state.
  expect(renders.get("srv-42")).toBe(2);
  expect(otherRowRenders("srv-42")).toBe(0);
  expect(summaryRenders).toBe(2);

  // A directory refresh on another Host touches only that Host.
  renders.clear();
  act(() => emit("srv-7", { agentDirectoryStatus: "revalidating" }));
  expect(renders.get("srv-7")).toBe(1);
  expect(otherRowRenders("srv-7")).toBe(0);
  console.info(
    `[P5] 100 Hosts: 200 no-op events → 0 renders; 1 Host offline → that row 2, others 0, summary 2`,
  );
});
