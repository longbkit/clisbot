// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@clisbot/protocol/agent-types";
import { openBotForm } from "./bot-form-model";
import { useBotProviderSnapshot } from "./use-bot-provider-snapshot";

const catalog = vi.hoisted(() => ({
  entries: undefined as ProviderSnapshotEntry[] | undefined,
  isLoading: true,
  error: null as string | null,
  refetchIfStale: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/use-providers-snapshot", () => ({ useProvidersSnapshot: () => catalog }));
beforeEach(() => {
  catalog.entries = undefined;
  catalog.isLoading = true;
  catalog.error = null;
  vi.clearAllMocks();
});
it("applies the later hydrated catalog instead of retaining an initial loading snapshot", () => {
  const model = openBotForm({
    mode: "create",
    defaults: {},
    hosts: [{ serverId: "host", label: "Host" }],
  });
  const { result, rerender } = renderHook(() => useBotProviderSnapshot(model, model.getState()));
  expect(model.getState().providerSnapshotRequest).not.toBeNull();
  catalog.entries = [{ provider: "codex", status: "loading", enabled: true, models: [] }];
  rerender();
  act(() => model.setProvider("codex"));
  catalog.entries = [
    {
      provider: "codex",
      status: "ready",
      enabled: true,
      models: [{ provider: "codex", id: "model-live", label: "Live model", isDefault: true }],
    },
  ];
  catalog.isLoading = false;
  rerender();
  expect(model.getState().selectedModel).toBe("model-live");
  expect(model.getState().providerSnapshotRequest).toBeNull();
  expect(result.current.isLoading).toBe(false);
  result.current.onOpen();
  expect(catalog.refetchIfStale).toHaveBeenCalledWith("codex");
  result.current.onRetryProvider("codex");
  expect(catalog.refresh).toHaveBeenCalledWith(["codex"]);
});
it("exposes catalog errors", () => {
  const model = openBotForm({
    mode: "create",
    defaults: {},
    hosts: [{ serverId: "host", label: "Host" }],
  });
  catalog.error = "Host is disconnected";
  const { result } = renderHook(() => useBotProviderSnapshot(model, model.getState()));
  expect(result.current.error).toBe("Host is disconnected");
});
