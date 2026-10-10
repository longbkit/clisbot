// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";

const mocks = vi.hoisted(() => ({
  projects: [] as SidebarProjectEntry[],
  unpin: vi.fn(),
}));
vi.mock("@/hooks/use-sidebar-workspaces-list", () => ({
  useSidebarWorkspacesList: () => ({ projects: mocks.projects }),
}));
vi.mock("@/hooks/use-sidebar-workspace-pin", () => ({
  useSidebarWorkspacePinController: () => mocks.unpin,
}));
vi.mock("../data/runtime", () => ({
  useBotCatalog: () => ({
    bots: { loadState: { status: "loaded", data: [] } },
    chats: { loadState: { status: "loaded", data: [] } },
  }),
}));
vi.mock("./pins", () => ({
  useResourcePins: () => ({ pins: [], toggle: vi.fn() }),
}));
vi.mock("./pin-target", () => ({ resolvePinTarget: vi.fn() }));
vi.mock("./use-sidebar-actions", () => ({
  useBotSidebarActions: () => ({ openBot: vi.fn(), error: null }),
}));
vi.mock("@/stores/sidebar-order-store", () => ({
  useSidebarOrderStore: (select: (state: { pinnedWorkspaceOrder: string[] }) => unknown) =>
    select({ pinnedWorkspaceOrder: ["saas:wks_shared", "mar:wks_shared"] }),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: create(() => ({ sessions: {} })),
}));
import { useSessionStore } from "@/stores/session-store";
import { usePinnedRows } from "./use-pinned-rows";

type Session = ReturnType<typeof useSessionStore.getState>["sessions"][string];
function session(name: string, pinnedAt: string | null = "2026-10-01T00:00:00Z"): Session {
  return {
    agents: new Map(),
    workspaces: new Map([["wks_shared", { id: "wks_shared", name, pinnedAt }]]),
  } as Session;
}

beforeEach(() => {
  mocks.unpin.mockClear();
  mocks.projects = ["mar", "saas"].map((serverId) => ({
    viewKey: serverId,
    projectName: serverId,
    projectKind: "git",
    iconWorkingDir: "/workspace",
    hosts: [
      {
        serverId,
        projectId: "project",
        iconWorkingDir: "/workspace",
        worktreeSupport: "supported",
      },
    ],
    workspaces: [
      {
        workspaceKey: `${serverId}:wks_shared`,
        serverId,
        workspaceId: "wks_shared",
        projectViewKey: serverId,
        projectName: serverId,
        projectKind: "git",
        workspaceKind: "checkout",
        name: "wks_shared",
      },
    ],
  }));
  useSessionStore.setState({
    sessions: { mar: session("Marketing"), saas: session("VAPI canary") },
  });
});

it("uses live workspace names per host while retaining pin order, routes and unpin identity", () => {
  const hook = renderHook(() => usePinnedRows());
  expect(hook.result.current.rows.map(({ title, route }) => ({ title, route }))).toEqual([
    { title: "VAPI canary", route: "/h/saas/workspace/wks_shared" },
    { title: "Marketing", route: "/h/mar/workspace/wks_shared" },
  ]);
  hook.result.current.rows[0]!.remove();
  expect(mocks.unpin).toHaveBeenCalledWith(
    expect.objectContaining({
      serverId: "saas",
      workspaceId: "wks_shared",
      pinnedAt: "2026-10-01T00:00:00Z",
    }),
  );
  hook.unmount();
});

it("reacts to workspace renames and unpins without changing structural placements", () => {
  const hook = renderHook(() => usePinnedRows());
  act(() =>
    useSessionStore.setState({
      sessions: { mar: session("Marketing"), saas: session("Renamed canary") },
    }),
  );
  expect(hook.result.current.rows.map((row) => row.title)).toEqual(["Renamed canary", "Marketing"]);
  act(() =>
    useSessionStore.setState({
      sessions: {
        mar: session("Marketing"),
        saas: session("Renamed canary", null),
      },
    }),
  );
  expect(hook.result.current.rows.map((row) => row.title)).toEqual(["Marketing"]);
  hook.unmount();
});
