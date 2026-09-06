// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubAccountEntryNavigation } from "./account-entry-navigation";

const state = vi.hoisted(() => ({
  url: "https://hub.example.test/?invitation=invitation-one",
  enabled: true,
  replace: vi.fn(),
}));
vi.mock("expo-linking", () => ({ useURL: () => state.url }));
vi.mock("expo-router", () => ({
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("./account-provider", () => ({
  useHubAccount: () => ({
    enabled: state.enabled,
    loading: false,
    signInKind: "system-browser",
    origin: "https://hub.example.test",
    state: { status: "signedOut" },
  }),
}));
afterEach(cleanup);
beforeEach(() => {
  state.enabled = true;
  state.url = "https://hub.example.test/?invitation=invitation-one";
  state.replace.mockClear();
});

describe("Hub account navigation bootstrap", () => {
  it("retains the invitation until protected Settings routes become available", () => {
    const screen = render(<HubAccountEntryNavigation navigationReady={false} />);
    expect(state.replace).not.toHaveBeenCalled();
    screen.rerender(<HubAccountEntryNavigation navigationReady />);
    expect(state.replace).toHaveBeenCalledWith({
      pathname: "/settings/hub/[hubSection]",
      params: { hubSection: "account", invitation: "invitation-one" },
    });
  });

  it("leaves disabled Hub builds and ordinary Paseo startup to the upstream router", () => {
    state.enabled = false;
    const screen = render(<HubAccountEntryNavigation navigationReady />);
    expect(state.replace).not.toHaveBeenCalled();
    state.enabled = true;
    state.url = "https://hub.example.test/";
    screen.rerender(<HubAccountEntryNavigation navigationReady />);
    expect(state.replace).not.toHaveBeenCalled();
  });
});
