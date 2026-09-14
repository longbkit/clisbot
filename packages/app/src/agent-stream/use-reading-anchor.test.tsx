/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { StreamItem } from "@/types/stream";
import { useReadingAnchor } from "./use-reading-anchor";
const f = vi.hoisted(() => ({ restore: vi.fn(), items: [] as unknown[], epoch: "epoch" }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: {
        host: {
          agentTimelineCursor: new Map([["agent", { epoch: f.epoch }]]),
          agentStreamTail: new Map([["agent", f.items]]),
          agentStreamHead: new Map(),
          viewedTimelineSync: { restoreReadingAnchor: f.restore },
        },
      },
    }),
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  f.items = [];
  f.epoch = "epoch";
});
const item: StreamItem = {
  id: "reading",
  kind: "assistant_message",
  timestamp: new Date(),
  text: "reading",
  timelineCursor: { epoch: "epoch", seqStart: 42, seq: 43 },
};
it("restores the retained row at the same offset without fetching", async () => {
  const scroll = vi.fn();
  const viewportRef = {
    current: {
      scrollToBottom: vi.fn(),
      prepareForViewportChange: vi.fn(),
      scrollToMessage: scroll,
      getMessageOffset: () => -32,
    },
  };
  const base = {
    serverId: "host",
    agentId: "agent",
    nearBottom: false,
    ready: true,
    head: [],
    viewportRef,
    visibleItemIds: new Set([item.id]),
    reveal: () => false,
  };
  const hook = renderHook(({ active, items }) => useReadingAnchor({ ...base, active, items }), {
    initialProps: { active: true, items: [item] },
  });
  act(() => hook.result.current.report(item.id));
  hook.rerender({ active: false, items: [] });
  hook.rerender({ active: true, items: [item] });
  await waitFor(() => expect(scroll).toHaveBeenCalledWith("reading", -32));
  expect(f.restore).not.toHaveBeenCalled();
});
it("fetches an evicted canonical anchor once and waits for its row before scrolling", async () => {
  const scroll = vi.fn();
  let finish!: () => void;
  f.restore.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const viewportRef = {
    current: {
      scrollToBottom: vi.fn(),
      prepareForViewportChange: vi.fn(),
      scrollToMessage: scroll,
      getMessageOffset: () => 12,
    },
  };
  const base = {
    serverId: "host",
    agentId: "agent",
    nearBottom: false,
    ready: true,
    head: [],
    viewportRef,
    visibleItemIds: new Set([item.id]),
    reveal: () => false,
  };
  const hook = renderHook(({ active, items }) => useReadingAnchor({ ...base, active, items }), {
    initialProps: { active: true, items: [item] },
  });
  act(() => hook.result.current.report(item.id));
  hook.rerender({ active: false, items: [] });
  hook.rerender({ active: true, items: [] });
  await waitFor(() =>
    expect(f.restore).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({ epoch: "epoch", seq: 42 }),
    ),
  );
  expect(scroll).not.toHaveBeenCalled();
  await act(async () => {
    f.items = [item];
    finish();
  });
  hook.rerender({ active: true, items: [item] });
  await waitFor(() => expect(scroll).toHaveBeenCalledWith("reading", 12));
  expect(f.restore).toHaveBeenCalledTimes(1);
});
