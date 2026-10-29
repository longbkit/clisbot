// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  bytes: 2_048,
  confirmed: true,
  failure: null as Error | null,
  confirmations: [] as unknown[],
}));
vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: async (input: unknown) => {
    state.confirmations.push(input);
    return state.confirmed;
  },
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ getReplicaCache: () => ({}) }),
}));
vi.mock("./clear", () => ({
  offlineDataBytes: async () => state.bytes,
  clearOfflineData: async () => {
    if (state.failure) throw state.failure;
    state.bytes = 0;
  },
}));

import { useOfflineStorage } from "./use-offline-storage";

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useOfflineStorage(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  state.bytes = 2_048;
  state.confirmed = true;
  state.failure = null;
  state.confirmations = [];
});

it("shows what is used, and clears only after a destructive confirmation", async () => {
  const view = render();
  await waitFor(() => expect(view.result.current.usedBytes).toBe(2_048));

  await act(() => view.result.current.clear());

  expect(state.confirmations).toEqual([expect.objectContaining({ destructive: true })]);
  expect(view.result.current.clearState).toEqual({ status: "cleared" });
  await waitFor(() => expect(view.result.current.usedBytes).toBe(0));
});

it("does nothing when the confirmation is dismissed", async () => {
  state.confirmed = false;
  const view = render();
  await waitFor(() => expect(view.result.current.usedBytes).toBe(2_048));

  await act(() => view.result.current.clear());

  expect(view.result.current.clearState).toEqual({ status: "idle" });
  expect(view.result.current.usedBytes).toBe(2_048);
});

it("keeps a visible failure when the cache cannot be cleared", async () => {
  state.failure = new Error("disk is read-only");
  const view = render();
  await waitFor(() => expect(view.result.current.usedBytes).toBe(2_048));

  await act(() => view.result.current.clear());

  expect(view.result.current.clearState).toEqual({ status: "failed" });
  expect(view.result.current.usedBytes).toBe(2_048);
});
