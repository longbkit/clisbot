/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  listedByHub: undefined as boolean | undefined,
  status: "ready",
  presence: "connected",
  retry: vi.fn(),
  managed: false,
  hosts: [] as { serverId: string }[],
  router: { push: vi.fn(), replace: vi.fn(), navigate: vi.fn(), back: vi.fn() },
  record: vi.fn(),
  stackMounts: 0,
  stackUnmounts: 0,
  leafMounts: 0,
  leafUnmounts: 0,
}));

vi.mock("expo-router", () => {
  function ProtectedHostLeaf() {
    React.useEffect(() => {
      state.leafMounts += 1;
      return () => {
        state.leafUnmounts += 1;
      };
    }, []);
    return <span data-testid="protected-host-leaf" />;
  }
  const Stack = Object.assign(
    function Stack({
      screenLayout,
    }: {
      screenLayout: (input: {
        route: { name: string };
        children: React.ReactNode;
      }) => React.ReactElement;
    }) {
      React.useEffect(() => {
        state.stackMounts += 1;
        return () => {
          state.stackUnmounts += 1;
        };
      }, []);
      // Match Expo's actual boundary: screenLayout receives a SceneView element
      // before its leaf has mounted. Exercise the real ThemedStack composition.
      return (
        <div data-testid="host-stack">
          {screenLayout({
            route: { name: "workspace/[workspaceId]/index" },
            children: <ProtectedHostLeaf />,
          })}
        </div>
      );
    },
    { Screen: () => null },
  );
  return {
    useRouter: () => state.router,
    useLocalSearchParams: () => ({ serverId: "srv" }),
    Redirect: () => <span>Unexpected redirect</span>,
    Stack,
  };
});
vi.mock("@/app/_layout", () => ({
  useHostRuntimeBootstrapState: () => ({ startupBlocker: { kind: "none" } }),
}));
vi.mock("@/clisbot/home/use-chat-list-navigation", () => ({
  useChatListScreenListeners: () => ({}),
}));
vi.mock("@/components/appearance-style-boundary", () => ({
  AppearanceStyleBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({}) },
  withUnistyles: (Component: React.ComponentType<{ backgroundColor: string }>) =>
    function Themed(props: object) {
      return <Component backgroundColor="#000" {...props} />;
    },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/clisbot/hub/host-inventory", () => ({
  useAvailableHosts: () => state.hosts,
  useHostInventory: () => ({
    hosts: state.hosts,
    status: state.status,
    retry: state.retry,
    daemons: {
      data: {
        daemons: state.listedByHub
          ? [{ id: "daemon", presence: state.presence, connectionOffer: { serverId: "srv" } }]
          : [],
      },
    },
  }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRegistryStatus: () => "ready",
  useHosts: () =>
    state.managed ? [{ serverId: "srv", management: { daemonId: "daemon" } }] : state.hosts,
}));
vi.mock("@/runtime/host-diagnostics", () => ({ recordHostDiagnostic: state.record }));

import HostRouteLayout from "@/app/h/[serverId]/_layout";

import { HostUnavailableScreen } from "./host-unavailable-screen";

beforeEach(() => {
  state.listedByHub = undefined;
  state.status = "ready";
  state.presence = "connected";
  state.managed = false;
  state.retry.mockClear();
  state.hosts = [];
  for (const fn of Object.values(state.router)) fn.mockClear();
  state.record.mockClear();
  state.stackMounts = 0;
  state.stackUnmounts = 0;
  state.leafMounts = 0;
  state.leafUnmounts = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function navigated() {
  const { push, replace, navigate, back } = state.router;
  return [push, replace, navigate, back].some((fn) => fn.mock.calls.length > 0);
}

it("says the Host is reconnecting and never navigates on its own", () => {
  state.listedByHub = true;
  state.hosts = [{ serverId: "other" }];
  render(<HostUnavailableScreen serverId="srv" />);

  expect(screen.getByText("hostUnavailable.reconnectingTitle")).toBeTruthy();
  expect(navigated()).toBe(false);
  expect(state.record).toHaveBeenCalledWith(
    "host-route-unavailable",
    expect.objectContaining({ serverId: "srv", listedByHub: true }),
  );
});

it("offers the reader the choices when the Host is gone, and leaves only when one is picked", () => {
  state.listedByHub = false;
  state.hosts = [{ serverId: "other" }];
  render(<HostUnavailableScreen serverId="srv" />);

  expect(screen.getByText("hostUnavailable.title")).toBeTruthy();
  expect(navigated()).toBe(false);

  fireEvent.click(screen.getByTestId("host-unavailable-open-other"));
  expect(state.router.push).toHaveBeenCalledWith("/open-project");
  fireEvent.click(screen.getByTestId("host-unavailable-add-host"));
  expect(state.router.push).toHaveBeenLastCalledWith("/welcome?stay=1");
});

it("offers only adding a Host when there is no other Host to open", () => {
  state.listedByHub = false;
  render(<HostUnavailableScreen serverId="srv" />);

  expect(screen.queryByTestId("host-unavailable-open-other")).toBeNull();
  expect(screen.getByTestId("host-unavailable-add-host")).toBeTruthy();
});

it("reports missing managed access immediately instead of waiting to connect", () => {
  state.managed = true;
  render(<HostUnavailableScreen serverId="srv" />);
  expect(screen.getByText("hostUnavailable.deniedTitle")).toBeTruthy();
  fireEvent.click(screen.getByTestId("host-unavailable-retry"));
  expect(state.retry).toHaveBeenCalledOnce();
});

it("shows known Hub offline status immediately", () => {
  state.listedByHub = true;
  state.presence = "offline";
  render(<HostUnavailableScreen serverId="srv" />);
  expect(screen.getByText("hostUnavailable.offlineTitle")).toBeTruthy();
  expect(screen.getByTestId("host-unavailable-retry")).toBeTruthy();
});

it("does not call unresolved access denied and bounds the wait with a working retry", () => {
  vi.useFakeTimers();
  state.status = "loading";
  state.managed = true;
  const { rerender } = render(<HostUnavailableScreen serverId="srv" />);
  expect(screen.getByText("hostUnavailable.loadingTitle")).toBeTruthy();
  expect(screen.queryByText("hostUnavailable.deniedTitle")).toBeNull();
  act(() => vi.advanceTimersByTime(20_000));
  expect(screen.getByText("hostUnavailable.timeoutTitle")).toBeTruthy();
  fireEvent.click(screen.getByTestId("host-unavailable-retry"));
  expect(state.retry).toHaveBeenCalledOnce();
  expect(screen.getByText("hostUnavailable.loadingTitle")).toBeTruthy();
  state.status = "error";
  rerender(<HostUnavailableScreen serverId="srv" />);
  expect(screen.getByText("hostUnavailable.errorTitle")).toBeTruthy();
  expect(screen.queryByText("hostUnavailable.deniedTitle")).toBeNull();
  expect(navigated()).toBe(false);
});

it("keeps the Host navigator without mounting an excluded managed Host's leaf", () => {
  state.managed = true;
  const { rerender } = render(<HostRouteLayout />);
  expect(screen.getByText("hostUnavailable.deniedTitle")).toBeTruthy();
  expect(screen.getByTestId("host-stack")).toBeTruthy();
  expect(screen.queryByTestId("protected-host-leaf")).toBeNull();
  expect(state.leafMounts).toBe(0);
  expect(state.stackMounts).toBe(1);
  state.hosts = [{ serverId: "srv" }];
  rerender(<HostRouteLayout />);
  expect(screen.getByTestId("host-stack")).toBeTruthy();
  expect(screen.getByTestId("protected-host-leaf")).toBeTruthy();
  expect(state.stackMounts).toBe(1);
  expect(navigated()).toBe(false);
});

it("retains navigator identity while removing inaccessible leaf content and recovering it", () => {
  state.hosts = [{ serverId: "srv" }];
  const { rerender } = render(<HostRouteLayout />);
  expect(screen.getByTestId("protected-host-leaf")).toBeTruthy();
  expect(state.stackMounts).toBe(1);
  expect(state.leafMounts).toBe(1);

  state.hosts = [];
  state.managed = true;
  rerender(<HostRouteLayout />);
  expect(screen.getByText("hostUnavailable.deniedTitle")).toBeTruthy();
  expect(screen.queryByTestId("protected-host-leaf")).toBeNull();
  expect(state.leafUnmounts).toBe(1);
  expect(state.stackUnmounts).toBe(0);
  expect(state.stackMounts).toBe(1);

  state.hosts = [{ serverId: "srv" }];
  rerender(<HostRouteLayout />);
  expect(screen.queryByTestId("host-unavailable")).toBeNull();
  expect(screen.getByTestId("protected-host-leaf")).toBeTruthy();
  expect(state.leafMounts).toBe(2);
  expect(state.stackMounts).toBe(1);
  expect(state.stackUnmounts).toBe(0);
  expect(navigated()).toBe(false);
});

it("keeps a saved direct Host route mounted without Hub access", () => {
  state.hosts = [{ serverId: "srv" }];
  state.status = "error";
  render(<HostRouteLayout />);
  expect(screen.getByTestId("host-stack")).toBeTruthy();
  expect(navigated()).toBe(false);
});
