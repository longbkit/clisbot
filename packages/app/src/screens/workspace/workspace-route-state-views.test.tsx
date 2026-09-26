// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWorkspaceRouteGate } from "./workspace-route-state-views";
import type { WorkspaceRouteState } from "./workspace-route-state";

const state = vi.hoisted(() => ({ serverId: "srv", hubOffline: false, refresh: vi.fn() }));
vi.mock("@/navigation/host-route-context", () => ({ useHostRouteServerId: () => state.serverId }));
vi.mock("@/clisbot/hub/host-inventory", () => ({
  useHostInventory: () => ({
    hosts: state.hubOffline ? [{ serverId: "srv", management: { daemonId: "daemon" } }] : [],
    daemons: { data: { daemons: [{ id: "daemon", presence: "offline" }] } },
    retry: state.refresh,
  }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => <span data-testid="spinner" />,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: () => null,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
}));
const actions = {
  onRetryHost: vi.fn(),
  onManageHost: vi.fn(),
  onDismissMissingWorkspace: vi.fn(),
  onRecoverWorkspace: vi.fn(),
  onRetryRecoveryInspection: vi.fn(),
};
const connecting: WorkspaceRouteState = {
  kind: "unreachable",
  hostName: "Laptop",
  connectionStatus: "connecting",
  lastError: null,
};
const view = (routeState: WorkspaceRouteState) =>
  renderWorkspaceRouteGate({ state: routeState, actions });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.hubOffline = false;
  state.serverId = "srv";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each(["idle", "connecting"] as const)(
  "bounds %s with retry and resets the deadline on an explicit retry",
  (connectionStatus) => {
    render(view({ ...connecting, connectionStatus }));
    act(() => vi.advanceTimersByTime(19_999));
    expect(screen.queryByText("common.actions.retry")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("workspace.route.connectionTimedOut")).toBeTruthy();
    expect(screen.queryByTestId("spinner")).toBeNull();
    fireEvent.click(screen.getByText("common.actions.retry"));
    expect(actions.onRetryHost).toHaveBeenCalledOnce();
    expect(screen.getByTestId("spinner")).toBeTruthy();
    act(() => vi.advanceTimersByTime(20_000));
    fireEvent.click(screen.getByText("workspace.route.manageHost"));
    expect(actions.onManageHost).toHaveBeenCalledOnce();
  },
);

it("shows a saved offline Host and retry immediately", () => {
  render(view({ ...connecting, connectionStatus: "offline", lastError: "Connection closed" }));
  expect(screen.getByText("workspace.route.hostOffline")).toBeTruthy();
  expect(screen.getByText("Connection closed")).toBeTruthy();
  expect(screen.getByText("common.actions.retry")).toBeTruthy();
  expect(screen.queryByTestId("spinner")).toBeNull();
});

it("uses a known Hub offline result while the transport is still connecting", () => {
  state.hubOffline = true;
  render(view(connecting));
  expect(screen.getByText("workspace.route.hostOffline")).toBeTruthy();
  fireEvent.click(screen.getByText("common.actions.retry"));
  expect(state.refresh).toHaveBeenCalledOnce();
  expect(actions.onRetryHost).toHaveBeenCalledOnce();
});

it("bounds workspace hydration too, and clears the timer once ready", () => {
  const { rerender } = render(view({ kind: "loading", hostName: "Laptop" }));
  act(() => vi.advanceTimersByTime(20_000));
  expect(screen.getByText("workspace.route.loadTimedOut")).toBeTruthy();
  fireEvent.click(screen.getByText("common.actions.retry"));
  expect(actions.onRetryHost).toHaveBeenCalledOnce();
  rerender(<>{view({ kind: "ready" })}</>);
  act(() => vi.advanceTimersByTime(20_000));
  expect(screen.queryByText("workspace.route.loadTimedOut")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("starts a fresh wait after switching Hosts", () => {
  const { rerender } = render(view(connecting));
  act(() => vi.advanceTimersByTime(19_000));
  state.serverId = "other";
  rerender(view({ ...connecting, hostName: "Other" }));
  act(() => vi.advanceTimersByTime(1_000));
  expect(screen.queryByText("common.actions.retry")).toBeNull();
  act(() => vi.advanceTimersByTime(19_000));
  expect(screen.getByText("common.actions.retry")).toBeTruthy();
});
