// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import { useAddProjectFlowStore } from "@/stores/add-project-flow-store";
import { useOpenAddProject } from "./use-open-add-project";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@/contexts/toast-api-context", () => ({ useToast: () => toast }));
afterEach(() => {
  cleanup();
  useSessionStore.getState().clearSession("host");
  useAddProjectFlowStore.getState().close();
  toast.error.mockReset();
});
it("denies Add project immediately and reevaluates current permissions on each click", () => {
  const store = useSessionStore.getState();
  store.initializeSession("host", null as unknown as DaemonClient);
  const info = { status: "server_info" as const, serverId: "host", hostname: null, version: null };
  store.updateSessionServerInfo("host", {
    ...info,
    permissions: ["workspace.read", "workspace.write"],
  });
  const hook = renderHook(() => useOpenAddProject());
  act(() => hook.result.current("host"));
  expect(useAddProjectFlowStore.getState().request).toBeNull();
  expect(toast.error).toHaveBeenCalledWith(
    "You do not have permission to add projects on this Host. Ask your administrator for access.",
  );
  store.updateSessionServerInfo("host", { ...info, permissions: ["workspace.manage"] });
  act(() => hook.result.current("host"));
  expect(useAddProjectFlowStore.getState().request?.preferredHostId).toBe("host");
});
