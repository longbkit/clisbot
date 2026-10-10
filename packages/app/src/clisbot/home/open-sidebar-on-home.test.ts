// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const layout = vi.hoisted(() => ({ compact: true, homeV2: false }));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => layout.compact }));
vi.mock("./feature", () => ({
  get HOME_V2_ENABLED() {
    return layout.homeV2;
  },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { useOpenSidebarOnHome } from "./open-sidebar-on-home";

const SERVER_ID = "home-sidebar-test";
const HOSTS = [{ serverId: SERVER_ID }];

function setProjects(ids: string[]) {
  const workspaces = new Map(ids.map((id) => [id, { id } as WorkspaceDescriptor]));
  act(() => useSessionStore.getState().setWorkspaces(SERVER_ID, workspaces));
}

const mobileTarget = () => usePanelStore.getState().mobilePanel.target;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  layout.compact = true;
  layout.homeV2 = false;
  useSessionStore.getState().initializeSession(SERVER_ID, {} as DaemonClient);
  usePanelStore.setState((state) => ({
    mobilePanel: { target: "agent", revision: 0 },
    desktop: { ...state.desktop, agentListOpen: false },
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useSessionStore.setState((state) => ({ ...state, sessions: {} }));
});

test("a phone with no projects stays on home", () => {
  renderHook(() => useOpenSidebarOnHome(HOSTS));
  expect(mobileTarget()).toBe("agent");
});

test("a phone opens the sidebar once a Host's projects arrive, and only once", () => {
  renderHook(() => useOpenSidebarOnHome(HOSTS));
  setProjects(["ws-1"]);
  expect(mobileTarget()).toBe("agent-list");

  // They close it; a later project does not open it again on this visit.
  usePanelStore.getState().showMobileAgent();
  setProjects([]);
  setProjects(["ws-1", "ws-2"]);
  expect(mobileTarget()).toBe("agent");
});

test("with Home V2 a phone keeps Home in view; its Chat tab is the sidebar", () => {
  layout.homeV2 = true;
  renderHook(() => useOpenSidebarOnHome(HOSTS));
  setProjects(["ws-1"]);
  expect(mobileTarget()).toBe("agent");
});

test.each([false, true])("desktop opens the sidebar even with no projects (Home V2: %s)", (v2) => {
  layout.compact = false;
  layout.homeV2 = v2;
  renderHook(() => useOpenSidebarOnHome(HOSTS));
  expect(usePanelStore.getState().desktop.agentListOpen).toBe(true);
});
