/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  listedByHub: undefined as boolean | undefined,
  hosts: [] as { serverId: string }[],
  router: { push: vi.fn(), replace: vi.fn(), navigate: vi.fn(), back: vi.fn() },
  record: vi.fn(),
}));

vi.mock("expo-router", () => ({ useRouter: () => state.router }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
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
vi.mock("@/clisbot/hub/host-synchronization", () => ({
  useHubListsHost: () => state.listedByHub,
}));
vi.mock("@/runtime/host-runtime", () => ({ useHosts: () => state.hosts }));
vi.mock("@/runtime/host-diagnostics", () => ({ recordHostDiagnostic: state.record }));

import { HostUnavailableScreen } from "./host-unavailable-screen";

beforeEach(() => {
  state.listedByHub = undefined;
  state.hosts = [];
  for (const fn of Object.values(state.router)) fn.mockClear();
  state.record.mockClear();
});
afterEach(cleanup);

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
