// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubWelcomeSignIn } from "./welcome-sign-in";

const env = vi.hoisted(() => ({
  hub: {} as Record<string, unknown>,
  params: {} as Record<string, string>,
  replace: vi.fn(),
  push: vi.fn(),
  hosts: [] as { serverId: string }[],
  daemons: undefined as { daemons: { connectionOffer: unknown }[] } | undefined,
  daemonsFailed: false,
  focused: true,
}));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => env.focused }));
vi.mock("expo-router", () => ({
  useRouter: () => ({ replace: env.replace, push: env.push }),
  useLocalSearchParams: () => env.params,
}));
vi.mock("./account-provider", () => ({ useHubAccount: () => env.hub }));
vi.mock("@/runtime/host-runtime", () => ({ useHosts: () => env.hosts }));
vi.mock("@/data/query", () => ({
  useFetchQuery: () => ({ data: env.daemons, isError: env.daemonsFailed }),
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/alert", () => ({
  Alert: ({ title }: { title: string }) => <p>{title}</p>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ onPress, children }: { onPress(): void; children: ReactNode }) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
}));

const accountRoute = "/settings/hub/account";
const signedInState = {
  status: "active",
  account: { id: "a", email: "a@vexere.com" },
  organization: { id: "o" },
};

function hubWith(overrides: Record<string, unknown>) {
  return {
    enabled: true,
    loading: false,
    origin: "https://hub.example.test",
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

beforeEach(() => {
  env.params = {};
  env.hosts = [];
  env.daemons = undefined;
  env.daemonsFailed = false;
  env.focused = true;
  env.hub = hubWith({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Hub sign-in on Welcome", () => {
  it("leads with Google and returns to Welcome to continue", () => {
    render(<HubWelcomeSignIn />);
    fireEvent.click(screen.getByText("Continue with Google"));
    expect(env.hub.signInWithGoogle).toHaveBeenCalledWith({ returnPath: "/welcome?hubSignIn=1" });
    fireEvent.click(screen.getByText("Use email and password instead"));
    expect(env.push).toHaveBeenCalledWith(accountRoute);
  });

  it("stays out of the way when Hub is off or already signed in without a sign-in here", () => {
    env.hub = hubWith({ enabled: false });
    const ui = render(<HubWelcomeSignIn />);
    expect(screen.queryByText("Paseo Hub")).toBeNull();
    env.hub = hubWith({ state: signedInState, signedIn: signedInState });
    ui.rerender(<HubWelcomeSignIn />);
    expect(screen.queryByText("Paseo Hub")).toBeNull();
    expect(env.replace).not.toHaveBeenCalled();
  });

  it("opens the app once the organization's Host is saved", () => {
    env.params = { hubSignIn: "1" };
    env.hub = hubWith({ state: signedInState, signedIn: signedInState });
    env.daemons = { daemons: [{ connectionOffer: {} }] };
    const ui = render(<HubWelcomeSignIn />);
    expect(env.replace).not.toHaveBeenCalled();
    env.hosts = [{ serverId: "srv" }];
    ui.rerender(<HubWelcomeSignIn />);
    ui.rerender(<HubWelcomeSignIn />);
    expect(env.replace).toHaveBeenCalledTimes(1);
    expect(env.replace).toHaveBeenCalledWith("/");
  });

  it("does not move a user away from a screen opened on top of Welcome", () => {
    env.params = { hubSignIn: "1" };
    env.focused = false;
    env.hub = hubWith({ state: signedInState, signedIn: signedInState });
    env.daemons = { daemons: [{ connectionOffer: null }] };
    render(<HubWelcomeSignIn />);
    expect(env.replace).not.toHaveBeenCalled();
  });

  it("opens Account when no Host is available or the account needs another step", () => {
    env.params = { hubSignIn: "1" };
    env.hub = hubWith({ state: signedInState, signedIn: signedInState });
    env.daemons = { daemons: [{ connectionOffer: null }] };
    render(<HubWelcomeSignIn />);
    expect(env.replace).toHaveBeenCalledWith(accountRoute);
    cleanup();
    env.replace.mockClear();
    env.hub = hubWith({ state: { status: "organizationRequired" }, signedIn: null });
    render(<HubWelcomeSignIn />);
    expect(env.replace).toHaveBeenCalledWith(accountRoute);
  });

  it("sends unfinished app setup and an unreadable Host list to Account", () => {
    env.params = { hubSignIn: "1" };
    const setup = { ...signedInState, status: "appSetupRequired" };
    env.hub = hubWith({ state: setup, signedIn: setup });
    env.daemons = { daemons: [{ connectionOffer: {} }] };
    env.hosts = [{ serverId: "srv" }];
    render(<HubWelcomeSignIn />);
    expect(env.replace).toHaveBeenCalledWith(accountRoute);
    cleanup();
    env.replace.mockClear();
    env.hub = hubWith({ state: signedInState, signedIn: signedInState });
    env.daemons = undefined;
    env.daemonsFailed = true;
    render(<HubWelcomeSignIn />);
    expect(env.replace).toHaveBeenCalledWith(accountRoute);
  });
});
