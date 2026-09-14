/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentPermissionResponseRecord } from "@getpaseo/protocol/session-authorship";
import { usePermissionHistory } from "./use-permission-history";

interface Page {
  records: AgentPermissionResponseRecord[];
  nextCursor?: number;
}
/** Hoisted so a page fixture is not a fourth nested callback inside `act`. */
function records(count: number, from = 0): AgentPermissionResponseRecord[] {
  return Array.from({ length: count }, (_, index) => record(from + index));
}

function record(index: number): AgentPermissionResponseRecord {
  return {
    id: `response-${index}`,
    timestamp: new Date(Date.UTC(2026, 8, 11, 0, 100 - index)).toISOString(),
    status: "pending",
    respondedBy: { kind: "user", id: "original", displayName: "Original name" },
    toolCallId: `tool-${index}`,
    request: { id: `request-${index}`, provider: "codex", name: "shell", kind: "tool" },
    response: { behavior: "allow" },
  };
}
function fixture() {
  const requests: Array<{
    options: { cursor?: number; signal: AbortSignal };
    resolve: (page: Page) => void;
    reject: (error: Error) => void;
  }> = [];
  const listeners = new Set<
    (message: { payload: { agentId: string; record: AgentPermissionResponseRecord } }) => void
  >();
  const connections = new Set<(connection: { status: string }) => void>();
  const client = {
    fetchPermissionResponses(_agentId: string, options: { cursor?: number; signal: AbortSignal }) {
      return new Promise<Page>((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("Request canceled")), {
          once: true,
        });
        requests.push({ options, resolve, reject });
      });
    },
    on(
      _type: string,
      listener: (message: {
        payload: { agentId: string; record: AgentPermissionResponseRecord };
      }) => void,
    ) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getConnectionState: () => ({ status: "connected" }),
    subscribeConnectionStatus(listener: (connection: { status: string }) => void) {
      connections.add(listener);
      return () => connections.delete(listener);
    },
  } as unknown as DaemonClient;
  return { client, requests, listeners, connections };
}
afterEach(cleanup);

describe("permission history window lifecycle", () => {
  it("keeps an older loaded decision applied through a stale fetched page without accumulating all history", async () => {
    const f = fixture();
    const hook = renderHook(() => usePermissionHistory(f.client, "server", "agent", true));
    await act(async () => {
      f.requests[0].resolve({ records: records(20), nextCursor: 20 });
    });
    act(() => hook.result.current.loadOlder());
    expect(f.requests[1].options.cursor).toBe(20);
    await act(async () => {
      f.requests[1].resolve({ records: records(20, 20) });
    });
    expect(hook.result.current.records).toHaveLength(20);
    expect(hook.result.current.viewingOlder).toBe(true);
    act(() => hook.result.current.loadRecent());
    act(() => {
      for (const listener of f.listeners)
        listener({ payload: { agentId: "agent", record: { ...record(35), status: "applied" } } });
    });
    expect(hook.result.current.records.find((entry) => entry.id === "response-35")?.status).toBe(
      "applied",
    );
    await act(async () => {
      f.requests[2].resolve({ records: [record(35), ...records(19)], nextCursor: 19 });
    });
    expect(hook.result.current.records.find((entry) => entry.id === "response-35")).toMatchObject({
      status: "applied",
      respondedBy: { id: "original", displayName: "Original name" },
    });
    expect(hook.result.current.records).toHaveLength(20);
  });

  it("keeps complete failed snapshots received before an older page arrives", async () => {
    const f = fixture();
    const hook = renderHook(() => usePermissionHistory(f.client, "server", "agent", true));
    await act(async () => {
      f.requests[0].resolve({ records: records(20), nextCursor: 20 });
    });
    act(() => hook.result.current.loadOlder());
    const failed = {
      ...record(35),
      status: "failed" as const,
      error: "Provider request was replaced",
      respondedBy: { kind: "user" as const, id: "responder-35" },
    };
    act(() => {
      for (const listener of f.listeners)
        listener({ payload: { agentId: "agent", record: failed } });
    });
    await act(async () => {
      f.requests[1].resolve({ records: records(20, 20) });
    });
    expect(hook.result.current.records.find((entry) => entry.id === "response-35")).toEqual(failed);
  });

  it("cancels on disconnect and disable, reloads recent on reconnect, and clears stale errors", async () => {
    const f = fixture();
    const hook = renderHook(
      ({ enabled }) => usePermissionHistory(f.client, "server", "agent", enabled),
      { initialProps: { enabled: true } },
    );
    await act(async () => {
      for (const listener of f.connections) listener({ status: "disconnected" });
    });
    expect(f.requests[0].options.signal.aborted).toBe(true);
    act(() => {
      for (const listener of f.connections) listener({ status: "connected" });
    });
    expect(f.requests[1].options.cursor).toBeUndefined();
    await act(async () => {
      f.requests[1].reject(new Error("Offline"));
    });
    expect(hook.result.current.error).toBe("Offline");
    act(() => hook.result.current.loadRecent());
    await act(async () => hook.rerender({ enabled: false }));
    expect(f.requests[2].options.signal.aborted).toBe(true);
    expect(hook.result.current).toMatchObject({
      error: null,
      loading: false,
      hasOlder: false,
      records: [],
    });
    expect(f.listeners.size).toBe(0);
    expect(f.connections.size).toBe(0);
  });
});
