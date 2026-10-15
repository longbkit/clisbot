// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  snapshot: {
    agentDirectoryStatus: "idle",
    connectionStatus: "connecting",
    agentDirectoryError: null as string | null,
    hasEverLoadedAgentDirectory: false,
  },
  listeners: new Set<() => void>(),
  hosts: [{ serverId: "host-a", label: "Host A" }],
  sessions: {},
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => state.hosts,
  getHostRuntimeStore: () => runtime,
}));
const runtime = {
  getSnapshot: () => state.snapshot,
  subscribeAll: (callback: () => void) => {
    state.listeners.add(callback);
    return () => state.listeners.delete(callback);
  },
  acquireDirectoryDemand: () => () => {},
  refreshDirectories: vi.fn(),
};
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (value: unknown) => unknown) =>
    selector({ sessions: state.sessions }),
}));
vi.mock("@/performance/native-trace", () => ({
  nativePerformanceTrace: { isEnabled: () => false },
}));
import { useAggregatedAgents } from "./use-aggregated-agents";

beforeEach(() => {
  state.snapshot = {
    agentDirectoryStatus: "idle",
    connectionStatus: "connecting",
    agentDirectoryError: null,
    hasEverLoadedAgentDirectory: false,
  };
});
afterEach(() => cleanup());

describe("directory loading while connecting", () => {
  it("distinguishes a pending first connection from an empty catalog", () => {
    const { result } = renderHook(() => useAggregatedAgents());
    expect(result.current.isInitialLoad).toBe(true);
    act(() => {
      state.snapshot = {
        ...state.snapshot,
        agentDirectoryStatus: "ready",
        connectionStatus: "online",
      };
      for (const listener of state.listeners) listener();
    });
    expect(result.current.isInitialLoad).toBe(false);
    expect(result.current.agents).toEqual([]);
  });
  it("exposes a failed first catalog load as a retryable error, rather than empty or loading", () => {
    const { result } = renderHook(() => useAggregatedAgents());
    act(() => {
      state.snapshot = {
        ...state.snapshot,
        agentDirectoryStatus: "error_before_first_success",
        connectionStatus: "online",
        agentDirectoryError: "Synthetic catalog failure",
      };
      for (const listener of state.listeners) listener();
    });
    expect(result.current.isInitialLoad).toBe(false);
    expect(result.current.directoryHealth).toEqual({
      status: "unavailable",
      serverId: "host-a",
      message: "Host A: Synthetic catalog failure",
      recovery: "retry",
    });
  });
  it("refreshes an accepted empty catalog without returning to first-load placeholders", () => {
    state.snapshot = {
      ...state.snapshot,
      agentDirectoryStatus: "ready",
      connectionStatus: "online",
      hasEverLoadedAgentDirectory: true,
    };
    const { result } = renderHook(() => useAggregatedAgents());
    act(() => {
      state.snapshot = { ...state.snapshot, agentDirectoryStatus: "revalidating" };
      for (const listener of state.listeners) listener();
    });
    expect(result.current.isInitialLoad).toBe(false);
    expect(result.current.isRevalidating).toBe(true);
  });
});
