// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

/**
 * Home's inbox and the Navigation V2 lists read the agents other surfaces loaded without holding
 * directory demand. Upstream v0.17 made `demand: false` skip the agent maps (a closed command
 * center); passive readers must still see them, or Home shows "For me 0" with sessions present.
 */
const state = vi.hoisted(() => ({
  hosts: [{ serverId: "host-a", label: "Host A" }],
  demands: [] as string[],
  agents: new Map([["agent-1", { id: "agent-1", serverId: "host-a" }]]),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => state.hosts,
  getHostRuntimeStore: () => ({
    acquireDirectoryDemand: (serverId: string) => {
      state.demands.push(serverId);
      return () => {};
    },
    refreshDirectories: vi.fn(),
  }),
}));
vi.mock("./use-directory-health", () => ({
  useDirectoryHealth: () => ({ status: "ready", hasAcceptedResult: true }),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (value: unknown) => unknown) =>
    selector({ sessions: { "host-a": { agents: state.agents } } }),
}));
vi.mock("@/performance/native-trace", () => ({
  nativePerformanceTrace: { isEnabled: () => false },
}));
vi.mock("./aggregated-agent-projector", () => ({
  sharedAggregatedAgentProjector:
    () =>
    ({ sessionAgents }: { sessionAgents: Record<string, Map<string, unknown> | undefined> }) =>
      Object.values(sessionAgents).flatMap((agents) => Array.from(agents?.values() ?? [])),
}));
import { useAggregatedAgents } from "./use-aggregated-agents";

afterEach(() => {
  cleanup();
  state.demands = [];
});

it("lets a passive reader see loaded agents without acquiring directory demand", () => {
  const { result } = renderHook(() => useAggregatedAgents({ demand: false, observe: true }));
  expect(result.current.agents).toEqual([{ id: "agent-1", serverId: "host-a" }]);
  expect(state.demands).toEqual([]);
});

it("keeps a surface without demand off the agent maps by default", () => {
  const { result } = renderHook(() => useAggregatedAgents({ demand: false }));
  expect(result.current.agents).toEqual([]);
  expect(state.demands).toEqual([]);
});

it("reads and demands the directory by default", () => {
  const { result } = renderHook(() => useAggregatedAgents());
  expect(result.current.agents).toEqual([{ id: "agent-1", serverId: "host-a" }]);
  expect(state.demands).toEqual(["host-a"]);
});
