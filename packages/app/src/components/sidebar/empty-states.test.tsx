// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  snapshots: {} as Record<string, Record<string, unknown>>,
  homeHealth: { status: "ready", hasAcceptedResult: true, message: null, serverId: null },
  hosts: [
    { serverId: "host-a", label: "Host A" },
    { serverId: "host-b", label: "Host B" },
  ],
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => state.hosts,
  useHostRegistryLoaded: () => true,
  getHostRuntimeStore: () => ({
    getSnapshot: (id: string) => state.snapshots[id],
    subscribeAll: () => () => {},
  }),
}));
vi.mock("@/stores/sidebar-view-store", () => ({
  useSidebarViewStore: (select: (value: unknown) => unknown) => select({ hostFilters: ["host-a"] }),
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => true }));
vi.mock("./sidebar-model", () => ({ useSidebarModel: () => ({ metadataRecoveryNotice: null }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init() {} },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/clisbot/home/activity-state", () => ({
  useHomeActivity: () => ({
    agents: [],
    isInitialLoad: false,
    directoryHealth: state.homeHealth,
    accepted: [],
    needs: 0,
    limit: 5,
  }),
}));
vi.mock("@/clisbot/home/activity-row", () => ({ ActivityRow: () => null }));
vi.mock("@/clisbot/home/activity-viewport", () => ({ ActivityAnchor: () => null }));
vi.mock("@/clisbot/home/mobile-navigation", () => ({ rememberChatReturn: () => {} }));
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: () => {} }));
vi.mock("@/components/directory-status", () => ({
  DirectoryStatus: () => <div />,
}));

import { SidebarProjectEmptyState } from "./empty-states";
import { HomeActivity } from "@/clisbot/home/activity-preview";

beforeEach(() => {
  const ready = {
    connectionStatus: "online",
    agentDirectoryStatus: "ready",
    hasEverLoadedAgentDirectory: true,
    workspaceDirectoryStatus: "ready",
    hasEverLoadedWorkspaceDirectory: true,
  };
  state.snapshots = { "host-a": { ...ready }, "host-b": { ...ready } };
  state.homeHealth = { status: "ready", hasAcceptedResult: true, message: null, serverId: null };
});
afterEach(cleanup);

describe("accepted empty bodies", () => {
  it("keeps the Chat card and focused action mounted during refresh and a subsequent error", () => {
    const view = render(<SidebarProjectEmptyState />);
    const card = screen.getByTestId("sidebar-project-empty-state");
    const action = screen.getByRole("button", { name: "sidebar.actions.addProject" });
    action.focus();
    Object.assign(state.snapshots["host-a"], {
      agentDirectoryStatus: "revalidating",
      workspaceDirectoryStatus: "revalidating",
    });
    view.rerender(<SidebarProjectEmptyState />);
    expect(screen.getByTestId("sidebar-project-empty-state")).toBe(card);
    expect(document.activeElement).toBe(action);
    Object.assign(state.snapshots["host-a"], {
      workspaceDirectoryStatus: "error_after_ready",
      workspaceDirectoryError: "Refresh failed",
    });
    view.rerender(<SidebarProjectEmptyState />);
    expect(screen.getByTestId("sidebar-project-empty-state")).toBe(card);
    expect(document.activeElement).toBe(action);
  });
  it("ignores excluded Host failures and connection attempts for a healthy selected empty Host", () => {
    Object.assign(state.snapshots["host-b"], {
      connectionStatus: "error",
      lastError: "Excluded Host unavailable",
    });
    const view = render(<SidebarProjectEmptyState />);
    const card = screen.getByTestId("sidebar-project-empty-state");
    Object.assign(state.snapshots["host-b"], { connectionStatus: "connecting", lastError: null });
    view.rerender(<SidebarProjectEmptyState />);
    expect(screen.getByTestId("sidebar-project-empty-state")).toBe(card);
  });
  it("keeps Home's accepted-empty text mounted during refresh and error", () => {
    const view = render(<HomeActivity />);
    const text = screen.getByText("Your conversations will appear here.");
    state.homeHealth = { ...state.homeHealth, status: "refreshing" };
    view.rerender(<HomeActivity />);
    expect(screen.getByText("Your conversations will appear here.")).toBe(text);
    state.homeHealth = { ...state.homeHealth, status: "unavailable" };
    view.rerender(<HomeActivity />);
    expect(screen.getByText("Your conversations will appear here.")).toBe(text);
  });
});
