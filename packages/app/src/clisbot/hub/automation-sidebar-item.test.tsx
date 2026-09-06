// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationSidebarItem } from "./automation-sidebar-item";

const account = vi.hoisted(() => ({
  enabled: false,
  signedIn: false,
  push: vi.fn(),
}));
vi.mock("./account-provider", () => ({
  useHubAccount: () => ({
    enabled: account.enabled,
    signedIn: account.signedIn ? {} : null,
  }),
}));
vi.mock("expo-router", () => ({
  usePathname: () => "/automations",
  useRouter: () => ({ push: account.push }),
}));
vi.mock("@/components/sidebar/sidebar-header-row", () => ({
  SidebarHeaderRow: ({
    label,
    onPress,
    isActive,
  }: {
    label: string;
    onPress(): void;
    isActive: boolean;
  }) => (
    <button aria-current={isActive ? "page" : undefined} onClick={onPress}>
      {label}
    </button>
  ),
}));
beforeEach(() => {
  vi.stubGlobal("React", React);
  account.push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Automation navigation", () => {
  it.each([
    { enabled: false, signedIn: false },
    { enabled: false, signedIn: true },
    { enabled: true, signedIn: false },
  ])("has no entry when Hub or its account is unavailable: %j", (state) => {
    Object.assign(account, state);
    render(<AutomationSidebarItem />);
    expect(screen.queryByRole("button", { name: "Automations" })).toBeNull();
  });
  it("closes the mobile sidebar and opens the active feature route", () => {
    Object.assign(account, { enabled: true, signedIn: true });
    const close = vi.fn();
    render(<AutomationSidebarItem onBeforeNavigate={close} />);
    const entry = screen.getByRole("button", { name: "Automations" });
    expect(entry.getAttribute("aria-current")).toBe("page");
    fireEvent.click(entry);
    expect(close).toHaveBeenCalledTimes(1);
    expect(account.push).toHaveBeenCalledWith("/automations");
  });
});
