// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { ResourcePin } from "./pins";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";

const mocks = vi.hoisted(() => ({
  projects: [] as SidebarProjectEntry[],
  pins: [] as ResourcePin[],
}));
vi.mock("@/components/sidebar/sidebar-model", () => ({
  useSidebarModel: () => ({ allProjects: mocks.projects, allWorkspaceEntriesByKey: new Map() }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "mar" }, { serverId: "saas" }],
}));
vi.mock("../data/runtime", () => ({
  useBotCatalog: () => ({
    bots: { loadState: { status: "loaded", data: [] } },
    chats: { loadState: { status: "loaded", data: [] } },
  }),
}));
vi.mock("./pins", () => ({
  useResourcePins: () => ({ pins: mocks.pins, toggle: vi.fn() }),
  pinKey: (pin: ResourcePin) => `${pin.kind}:${pin.serverId}:${pin.id}`,
}));
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
    projects: new Map([
      [
        "project",
        {
          projectId: "project",
          projectDisplayName: name,
          projectKind: "git",
          projectRootPath: "/workspace",
        },
      ],
    ]),
    workspaceAgentActivity: new Map(),
    messageSubmissions: new Map(),
    workspaces: new Map([
      [
        "wks_shared",
        {
          id: "wks_shared",
          name,
          pinnedAt,
          projectId: "project",
          projectDisplayName: name,
          projectKind: "git",
          workspaceKind: "checkout",
          workspaceDirectory: "/workspace",
          projectRootPath: "/workspace",
          status: "done",
          statusEnteredAt: null,
          scripts: [],
        },
      ],
    ]),
  } as unknown as Session;
}

beforeEach(() => {
  mocks.pins = [];
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

it("uses live workspace names per host while retaining pin order, routes and action identity", () => {
  const hook = renderHook(() => usePinnedRows());
  expect(hook.result.current.rows.map(({ title, route }) => ({ title, route }))).toEqual([
    { title: "VAPI canary", route: "/h/saas/workspace/wks_shared" },
    { title: "Marketing", route: "/h/mar/workspace/wks_shared" },
  ]);
  expect(hook.result.current.rows[0]).toMatchObject({
    kind: "workspace",
    workspace: {
      serverId: "saas",
      workspaceId: "wks_shared",
      pinnedAt: "2026-10-01T00:00:00Z",
    },
  });
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

it("keeps project actions on the pinned Host even with the same project ID and a filtered sidebar", () => {
  mocks.projects = [];
  mocks.pins = [{ kind: "project", serverId: "saas", id: "project" }];
  const hook = renderHook(() => usePinnedRows());
  const row = hook.result.current.rows[0]!;
  expect(row.kind).toBe("project");
  if (row.kind !== "project") throw Error("Missing pinned project");
  expect(row.project.hosts.map((h) => h.serverId)).toEqual(["saas"]);
  expect(row.title).toBe("VAPI canary");
  expect(row.route).toBe("/h/saas/workspace/wks_shared");
  hook.unmount();
});

it("resolves a session through accepted workspace authority and updates pending permissions", () => {
  mocks.projects = []; // Display filters do not revoke an accepted workspace.
  mocks.pins = [{ kind: "session", serverId: "saas", id: "agent" }];
  const s = session("VAPI canary");
  const agent = {
    id: "agent",
    title: "Session",
    workspaceId: "wks_shared",
    status: "idle",
    turn: { phase: "idle" },
    pendingPermissions: [],
    archivedAt: null,
  } as unknown as Session["agents"] extends Map<string, infer A> ? A : never;
  s.agents.set(agent.id, agent);
  useSessionStore.setState({ sessions: { saas: s } });
  const hook = renderHook(() => usePinnedRows());
  expect(hook.result.current.rows[0]).toMatchObject({
    kind: "session",
    session: { statusBucket: "done" },
  });
  act(() =>
    useSessionStore.setState({
      sessions: {
        saas: {
          ...s,
          agents: new Map([
            [
              agent.id,
              {
                ...agent,
                pendingPermissions: [
                  { id: "approval", provider: "mock", name: "Approval", kind: "tool" },
                ],
              },
            ],
          ]),
        } as Session,
      },
    }),
  );
  expect(hook.result.current.rows[0]).toMatchObject({
    kind: "session",
    session: { statusBucket: "needs_input" },
  });
  act(() => useSessionStore.setState({ sessions: { saas: { ...s, workspaces: new Map() } } }));
  expect(hook.result.current.rows).toEqual([]);
  hook.unmount();
});
