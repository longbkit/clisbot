// @vitest-environment jsdom
import React, { memo } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { defaultHostAppearance } from "@/hosts/appearance";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { seedRuntimeWorkspaces } from "@/test/seed-session";
import type { HostProfile } from "@/types/host-connection";
import { SidebarActiveFilters } from "./display-preferences/active-filters";
import { RetainedSidebarModel, SidebarModelProvider, useSidebarModel } from "./sidebar-model";

const scans = vi.hoisted(() => ({ metadata: 0 }));
// Counts full scans of every Host's workspaces for the user and channel filter options.
vi.mock("@/clisbot/session-storage/directory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/clisbot/session-storage/directory")>();
  return {
    ...actual,
    sessionMetadataOptions: (...args: Parameters<typeof actual.sessionMetadataOptions>) => {
      scans.metadata += 1;
      return actual.sessionMetadataOptions(...args);
    },
  };
});

// Fixtures have no live connection; every registered Host counts as connected.
vi.mock("@/runtime/host-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/runtime/host-runtime")>()),
  useHostRuntimeConnectedServerIds: (serverIds: readonly string[]) => [...serverIds],
}));
vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

function workspace(id: string): WorkspaceDescriptor {
  return {
    createdAt: null,
    lastUserMessageAt: null,
    id,
    projectId: "project-1",
    projectDisplayName: "Project 1",
    projectRootPath: "/repo/main",
    workspaceDirectory: `/repo/main/${id}`,
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
    status: "done",
    archivingAt: null,
    statusEnteredAt: null,
    diffStat: null,
    scripts: [],
  };
}

function host(): HostProfile {
  const now = "2026-04-19T00:00:00.000Z";
  return {
    serverId: "srv",
    label: "Host",
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections: [],
    preferredConnectionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function seed(ids: string[]) {
  act(() => {
    seedRuntimeWorkspaces("srv", new Map(ids.map((id) => [id, workspace(id)])));
  });
}

const renders = { work: 0 };

/** Stands in for the Work pane body: memoized, so only a new model re-renders it. */
const WorkBody = memo(function WorkBody() {
  renders.work += 1;
  const { workspacePlacements } = useSidebarModel();
  return <div data-testid="workspaces">{workspacePlacements.length}</div>;
});
const workBody = <WorkBody />;

function Work({ shown }: { shown: boolean }) {
  return (
    <SidebarModelProvider active>
      <RetainedPanelActivity active={shown}>
        <RetainedSidebarModel>{workBody}</RetainedSidebarModel>
      </RetainedPanelActivity>
    </SidebarModelProvider>
  );
}

function Mounted({ shown }: { shown: boolean }) {
  const [client] = React.useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <Work shown={shown} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  useSidebarViewStore.setState({ groupMode: "project", hostFilters: [] });
  act(() => {
    (
      getHostRuntimeStore() as unknown as { setHostsAndSync: (hosts: HostProfile[]) => void }
    ).setHostsAndSync([host()]);
    useSessionStore.getState().initializeSession("srv", null as unknown as DaemonClient);
    seedRuntimeWorkspaces("srv", new Map([["ws-1", workspace("ws-1")]]));
    useSessionStore.getState().setHasHydratedWorkspaces("srv", true);
  });
  renders.work = 0;
});

afterEach(() => {
  cleanup();
  act(() => {
    (
      getHostRuntimeStore() as unknown as { setHostsAndSync: (hosts: HostProfile[]) => void }
    ).setHostsAndSync([]);
    useSessionStore.getState().clearSession("srv");
  });
});

const held = { renders: 0, model: null as ReturnType<typeof useSidebarModel> | null };

/** Reads the provider's model directly, without a held boundary: it renders once per new model. */
const ModelProbe = memo(function ModelProbe() {
  held.renders += 1;
  held.model = useSidebarModel();
  return null;
});
const modelProbe = <ModelProbe />;

/** The phone's Work tab: its provider is the only one, and it holds while the tab is hidden. */
function PhoneWork({ active }: { active: boolean }) {
  const [client] = React.useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <SidebarModelProvider active={active} holdWhileInactive>
        {modelProbe}
      </SidebarModelProvider>
    </QueryClientProvider>
  );
}

function updateWorkspace(id: string, patch: Partial<WorkspaceDescriptor>) {
  act(() => {
    useSessionStore.getState().mergeWorkspaces("srv", [{ ...workspace(id), ...patch }]);
  });
}

describe("SidebarModelProvider held while its pane is hidden", () => {
  it("derives no new model for directory updates and catches up once when shown", () => {
    const view = render(<PhoneWork active />);
    view.rerender(<PhoneWork active={false} />);
    const before = held.model;
    held.renders = 0;
    updateWorkspace("ws-1", { status: "running" });
    seed(["ws-1", "ws-2"]);
    updateWorkspace("ws-2", { name: "renamed" });
    expect(held.renders).toBe(0);
    expect(held.model).toBe(before);
    view.rerender(<PhoneWork active />);
    expect(held.renders).toBe(1);
    const shown = held.model?.workspacePlacements.map((entry) => entry.workspaceId) ?? [];
    expect([...shown].sort()).toEqual(["ws-1", "ws-2"]);
    expect(held.model?.allWorkspaceEntriesByKey.get("srv:ws-2")?.name).toBe("renamed");
  });

  it("derives once at mount when the pane mounts hidden", () => {
    seed(["ws-1", "ws-2"]);
    held.renders = 0;
    render(<PhoneWork active={false} />);
    expect(held.model?.workspacePlacements).toHaveLength(2);
    const mounted = held.renders;
    updateWorkspace("ws-1", { status: "running" });
    expect(held.renders).toBe(mounted);
  });
});

/** The Host stores session metadata, so the user and channel filters read its workspaces. */
function markSessionStorageReadable() {
  const sessions = useSessionStore.getState().sessions;
  const srv = {
    ...sessions.srv,
    serverInfo: { features: { agentSessionStorageRead: true } },
  } as (typeof sessions)["srv"];
  useSessionStore.setState({ sessions: { ...sessions, srv } });
}

function ChipsUnderWork() {
  const [client] = React.useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <SidebarModelProvider active>
        <SidebarActiveFilters />
      </SidebarModelProvider>
    </QueryClientProvider>
  );
}

describe("session metadata options", () => {
  it("scans the workspaces once per directory change for the model and its filter chips", () => {
    act(markSessionStorageReadable);
    render(<ChipsUnderWork />);
    scans.metadata = 0;
    updateWorkspace("ws-1", { status: "running" });
    expect(scans.metadata).toBe(1);
  });
});

describe("RetainedSidebarModel", () => {
  it("passes model updates through while Work is shown", () => {
    render(<Mounted shown />);
    seed(["ws-1", "ws-2"]);
    expect(screen.getByTestId("workspaces").textContent).toBe("2");
  });

  it("does not re-render a hidden Work body when Host directories change", () => {
    const view = render(<Mounted shown />);
    view.rerender(<Mounted shown={false} />);
    renders.work = 0;
    seed(["ws-1", "ws-2"]);
    seed(["ws-1", "ws-2", "ws-3"]);
    expect(renders.work).toBe(0);
    expect(screen.getByTestId("workspaces").textContent).toBe("1");
  });

  it("shows the latest model in the first render after Work returns", () => {
    const view = render(<Mounted shown />);
    view.rerender(<Mounted shown={false} />);
    seed(["ws-1", "ws-2", "ws-3"]);
    renders.work = 0;
    view.rerender(<Mounted shown />);
    expect(renders.work).toBe(1);
    expect(screen.getByTestId("workspaces").textContent).toBe("3");
  });
});
