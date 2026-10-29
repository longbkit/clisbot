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
import { RetainedSidebarModel, SidebarModelProvider, useSidebarModel } from "./sidebar-model";

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
