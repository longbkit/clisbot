// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hubHostSynchronizationKey,
  setHubHostSynchronizationFailure,
} from "./host-synchronization-status";
import { HubWelcomeSignIn } from "./welcome-sign-in";

const env = vi.hoisted(() => ({
  hub: {} as Record<string, unknown>,
  params: {} as Record<string, string>,
  replace: vi.fn(),
  push: vi.fn(),
  hosts: [] as { serverId: string; label: string }[],
  daemons: undefined as { daemons: Record<string, unknown>[] } | undefined,
  daemonsFailed: false,
  daemonsPending: false,
  refetch: vi.fn(),
  focused: true,
}));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => env.focused }));
vi.mock("expo-router", () => ({
  useRouter: () => ({ replace: env.replace, push: env.push }),
  useLocalSearchParams: () => env.params,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./account-provider", () => ({ useHubAccount: () => env.hub }));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => env.hosts,
  useHostRuntimeConnectionStatuses: () => new Map(),
}));
vi.mock("@/data/query", () => ({
  useFetchQuery: () => ({
    data: env.daemons,
    isError: env.daemonsFailed,
    isPending: env.daemonsPending,
    isFetching: false,
    refetch: env.refetch,
  }),
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/alert", () => ({
  Alert: ({ title }: { title: string }) => <p>{title}</p>,
}));
vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { label: string }) => <em>{label}</em>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    onPress,
    children,
    disabled,
  }: {
    onPress(): void;
    children: ReactNode;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));

const HUB_ORIGIN = "https://hub.example.test";
const FAILED_HOST_KEY = hubHostSynchronizationKey({
  origin: HUB_ORIGIN,
  organizationId: "o",
  accountId: "a",
  daemonId: "daemon-1",
});
const accountRoute = "/settings/hub/account";
const signedInState = {
  status: "active",
  account: { id: "a", email: "a@vexere.com" },
  organization: { id: "o", name: "Vexere" },
  capabilities: { manageResources: false },
};

function daemon(overrides: Record<string, unknown> = {}) {
  return {
    id: "daemon-1",
    slug: "acme-mac",
    canManage: false,
    presence: "connected",
    connectionOffer: { serverId: "srv" },
    ...overrides,
  };
}

function hubWith(overrides: Record<string, unknown>) {
  return {
    enabled: true,
    loading: false,
    origin: HUB_ORIGIN,
    signInKind: "password",
    state: { status: "signedOut", googleSignIn: true },
    signedIn: null,
    error: null,
    signIn: vi.fn(async () => {}),
    signInWithGoogle: vi.fn(async () => {}),
    api: () => ({ get: vi.fn() }),
    ...overrides,
  };
}

function signedInHub(overrides: Record<string, unknown> = {}) {
  return hubWith({ state: signedInState, signedIn: signedInState, ...overrides });
}

beforeEach(() => {
  env.params = {};
  env.hosts = [];
  env.daemons = undefined;
  env.daemonsFailed = false;
  env.daemonsPending = false;
  env.focused = true;
  env.hub = hubWith({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // The failure store is a module singleton: leaving an entry behind would leak into later tests.
  setHubHostSynchronizationFailure(FAILED_HOST_KEY, null);
});

describe("Hub sign-in on Welcome", () => {
  it("leads with Google and returns to Welcome to continue", () => {
    render(<HubWelcomeSignIn />);
    fireEvent.click(screen.getByText("Continue with Google"));
    expect(env.hub.signInWithGoogle).toHaveBeenCalledWith({
      returnPath: "/welcome?stay=1&hubSignIn=1",
    });
    fireEvent.click(screen.getByText("Use email and password instead"));
    expect(env.push).toHaveBeenCalledWith(accountRoute);
  });

  it("shows nothing at all when this build has no Hub", () => {
    env.hub = hubWith({ enabled: false });
    render(<HubWelcomeSignIn />);
    expect(screen.queryByText("Paseo Hub")).toBeNull();
  });

  it("keeps the card after sign-in, naming the account and what its Hosts are doing", () => {
    env.hub = signedInHub();
    env.daemons = { daemons: [daemon()] };
    render(<HubWelcomeSignIn />);
    expect(screen.getByText("Paseo Hub")).toBeTruthy();
    expect(screen.getByText("a@vexere.com · Vexere")).toBeTruthy();
    expect(screen.getByText("Connecting to acme-mac…")).toBeTruthy();
    expect(env.replace).not.toHaveBeenCalled();
  });

  it("says when the organization shares no Host, and rereads the list on request", () => {
    env.hub = signedInHub();
    env.daemons = { daemons: [] };
    render(<HubWelcomeSignIn />);
    expect(screen.getByText("No Host")).toBeTruthy();
    fireEvent.click(screen.getByText("Refresh Hosts"));
    expect(env.refetch).toHaveBeenCalled();
  });

  it("reports a Host that failed to save, and retries it", () => {
    env.hub = signedInHub();
    env.daemons = { daemons: [daemon()] };
    const retry = vi.fn();
    setHubHostSynchronizationFailure(FAILED_HOST_KEY, { message: "access ticket refused", retry });
    render(<HubWelcomeSignIn />);
    expect(screen.getByText("Couldn't connect acme-mac: access ticket refused")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    expect(retry).toHaveBeenCalled();
  });

  it("holds a place for a second Hub once signed in, and never before", () => {
    render(<HubWelcomeSignIn />);
    expect(screen.queryByText("+ Add another Hub")).toBeNull();
    cleanup();
    env.hub = signedInHub();
    env.daemons = { daemons: [daemon()] };
    render(<HubWelcomeSignIn />);
    expect(screen.getByText("+ Add another Hub").hasAttribute("disabled")).toBe(true);
  });

  it("opens the app once the organization's Host is saved", () => {
    env.params = { hubSignIn: "1" };
    env.hub = signedInHub();
    env.daemons = { daemons: [daemon()] };
    const ui = render(<HubWelcomeSignIn />);
    expect(env.replace).not.toHaveBeenCalled();
    env.hosts = [{ serverId: "srv", label: "acme-mac" }];
    ui.rerender(<HubWelcomeSignIn />);
    ui.rerender(<HubWelcomeSignIn />);
    expect(env.replace).toHaveBeenCalledTimes(1);
    expect(env.replace).toHaveBeenCalledWith("/");
  });

  it("does not move a user away from a screen opened on top of Welcome", () => {
    env.params = { hubSignIn: "1" };
    env.focused = false;
    env.hub = signedInHub();
    env.daemons = { daemons: [daemon({ connectionOffer: null })] };
    render(<HubWelcomeSignIn />);
    expect(env.replace).not.toHaveBeenCalled();
  });

  it("opens Account when no Host is available or the account needs another step", () => {
    env.params = { hubSignIn: "1" };
    env.hub = signedInHub();
    env.daemons = { daemons: [daemon({ connectionOffer: null })] };
    render(<HubWelcomeSignIn />);
    expect(env.replace).toHaveBeenCalledWith(accountRoute);
    cleanup();
    env.replace.mockClear();
    env.hub = hubWith({ state: { status: "organizationRequired" }, signedIn: null });
    render(<HubWelcomeSignIn />);
    expect(screen.getByText("Choose an organization to continue.")).toBeTruthy();
    expect(env.replace).toHaveBeenCalledWith(accountRoute);
  });

  it("sends unfinished app setup and an unreadable Host list to Account", () => {
    env.params = { hubSignIn: "1" };
    const setup = { ...signedInState, status: "appSetupRequired" };
    env.hub = hubWith({ state: setup, signedIn: setup });
    env.daemons = { daemons: [daemon()] };
    env.hosts = [{ serverId: "srv", label: "acme-mac" }];
    render(<HubWelcomeSignIn />);
    expect(env.replace).toHaveBeenCalledWith(accountRoute);
    cleanup();
    env.replace.mockClear();
    env.hub = signedInHub();
    env.daemons = undefined;
    env.daemonsFailed = true;
    render(<HubWelcomeSignIn />);
    expect(env.replace).toHaveBeenCalledWith(accountRoute);
  });
});
