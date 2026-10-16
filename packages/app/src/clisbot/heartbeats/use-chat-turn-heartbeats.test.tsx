// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const host = vi.hoisted(() => ({
  hosts: [{ serverId: "host", label: "Host" }],
  statuses: new Map([["host", "online"]]),
  scheduleList: vi.fn(),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => host.hosts,
  useHostRuntimeConnectionStatuses: () => host.statuses,
  getHostRuntimeStore: () => ({
    getClient: () => ({ scheduleList: host.scheduleList }),
    getSnapshot: () => ({ connectionStatus: "online" }),
  }),
}));
import type { ChatRenderRow } from "@/clisbot/bots/chat/render-model";
import { useHostHeartbeats } from "./use-heartbeats";
import { useChatTurnHeartbeats } from "./use-chat-turn-heartbeats";
import { schedulesQueryKey } from "@/hooks/use-schedules";
const row = (key: string, seq = 1): ChatRenderRow => ({
  kind: "bot",
  key,
  botId: "bot",
  opensGroup: true,
  line: {
    id: key,
    seq,
    at: "2026-10-16T00:00:00Z",
    sender: { kind: "bot", botId: "bot" },
    text: "Reply",
    agentId: "agent",
  },
});
const key = [...schedulesQueryKey(["host"]), "online"];
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  host.scheduleList
    .mockReset()
    .mockImplementation(() => Promise.resolve({ schedules: [], error: null }));
});
afterEach(() => {
  cleanup();
  client.clear();
});
function mount(initialRows: ChatRenderRow[]) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    ({ rows }: { rows: ChatRenderRow[] }) => {
      // The closed header still reads the live count; the transcript reads heartbeat cards.
      const header = useHostHeartbeats("host");
      const cards = useChatTurnHeartbeats("host", rows);
      return { header, cards };
    },
    { wrapper, initialProps: { rows: initialRows } },
  );
}
it("accepted-history mount shares the mandatory schedule refresh instead of canceling and duplicating it", async () => {
  client.setQueryData(key, { status: "loaded", data: [], hostErrors: [] });
  const view = mount([row("accepted")]);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(host.scheduleList).toHaveBeenCalledTimes(1);
  expect(view.result.current.header.heartbeats).toEqual([]);
});
it("a newly appended bot reply still refreshes schedules while the header is closed", async () => {
  const accepted = row("accepted");
  const view = mount([accepted]);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const before = host.scheduleList.mock.calls.length;
  act(() => {
    view.rerender({ rows: [accepted, row("new", 2)] });
  });
  await waitFor(() => expect(host.scheduleList).toHaveBeenCalledTimes(before + 1));
  await waitFor(() => expect(client.isFetching()).toBe(0));
});
it("initially empty transcript still refreshes when the first bot line actually arrives", async () => {
  const view = mount([]);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const before = host.scheduleList.mock.calls.length;
  view.rerender({ rows: [row("first")] });
  await waitFor(() => expect(host.scheduleList).toHaveBeenCalledTimes(before + 1));
  await waitFor(() => expect(client.isFetching()).toBe(0));
});
it("a new reply during a held mount refresh still replaces that request and keeps its newer count", async () => {
  const pending: ((value: { schedules: unknown[]; error: null }) => void)[] = [];
  host.scheduleList.mockImplementation(
    () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
  );
  client.setQueryData(key, { status: "loaded", data: [], hostErrors: [] });
  const accepted = row("accepted");
  const view = mount([accepted]);
  await waitFor(() => expect(pending).toHaveLength(1));
  view.rerender({ rows: [accepted, row("new", 2)] });
  await waitFor(() => expect(pending).toHaveLength(2));
  const heartbeat = {
    id: "heartbeat",
    target: { type: "agent", agentId: "agent" },
    status: "active",
    createdAt: "2026-10-16T00:00:00Z",
  };
  await act(async () => {
    pending[1]!({ schedules: [heartbeat], error: null });
  });
  await waitFor(() => expect(view.result.current.header.heartbeats).toHaveLength(1));
  await act(async () => {
    pending[0]!({ schedules: [], error: null });
  });
  expect(view.result.current.header.heartbeats[0]?.id).toBe("heartbeat");
});
it("closed-trigger count still refreshes on mount and an explicit menu refresh", async () => {
  client.setQueryData(key, { status: "loaded", data: [], hostErrors: [] });
  host.scheduleList.mockResolvedValue({
    schedules: [
      {
        id: "heartbeat",
        target: { type: "agent", agentId: "agent" },
        status: "active",
        createdAt: "2026-10-16T00:00:00Z",
      },
    ],
    error: null,
  });
  const view = mount([row("accepted")]);
  await waitFor(() => expect(view.result.current.header.heartbeats).toHaveLength(1));
  expect(host.scheduleList).toHaveBeenCalledTimes(1);
  host.scheduleList.mockResolvedValue({ schedules: [], error: null });
  act(() => {
    view.result.current.header.refetch();
  });
  await waitFor(() => expect(view.result.current.header.heartbeats).toHaveLength(0));
  expect(host.scheduleList).toHaveBeenCalledTimes(2);
});
it("failed authoritative mount refresh remains an error rather than becoming a cache success", async () => {
  client.setQueryData(key, { status: "loaded", data: [], hostErrors: [] });
  host.scheduleList.mockResolvedValue({
    schedules: [],
    error: "Access denied",
  });
  mount([row("accepted")]);
  await waitFor(() => expect(client.getQueryState(key)?.status).toBe("error"));
  expect(host.scheduleList).toHaveBeenCalledTimes(1);
});
