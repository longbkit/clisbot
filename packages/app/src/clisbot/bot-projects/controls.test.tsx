// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotProjectsGroup, BotProjectsToggle } from "./controls";
import { useBotProjectsPreference } from "./preferences";
const env = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/clisbot/bots/feature", () => ({ useBotsFeatureHosts: () => (env.enabled ? [{}] : []) }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/constants/platform", () => ({ isNative: false }));
vi.mock("lucide-react-native", () => ({
  ChevronDown: () => <i data-testid="expanded-chevron" />,
  ChevronRight: () => <i data-testid="collapsed-chevron" />,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    value,
    onValueChange,
    testID,
    accessibilityLabel,
  }: {
    value: boolean;
    onValueChange: () => void;
    testID: string;
    accessibilityLabel: string;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={accessibilityLabel}
      data-testid={testID}
      onClick={onValueChange}
    />
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Pressable: ({
    children,
    onPress,
    testID,
  }: {
    children: ReactNode;
    onPress: () => void;
    testID: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/menu", () => ({
  MenuItem: ({
    children,
    onSelect,
    testID,
    selected,
  }: {
    children: ReactNode;
    onSelect: () => void;
    testID: string;
    selected: boolean;
  }) => (
    <button type="button" data-testid={testID} aria-pressed={selected} onClick={onSelect}>
      {children}
    </button>
  ),
}));
beforeEach(() => {
  vi.stubGlobal("React", React);
  env.enabled = true;
  useBotProjectsPreference.setState({ showBotProjects: false, botProjectsCollapsed: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("keeps menu and heading toggle in sync", () => {
  render(
    <>
      <BotProjectsToggle />
      <BotProjectsToggle menu />
    </>,
  );
  expect(
    screen.getByRole("switch", { name: "Show Bot projects" }).getAttribute("aria-checked"),
  ).toBe("false");
  expect(screen.queryByText("✓ Bot projects")).toBeNull();
  fireEvent.click(screen.getByTestId("sidebar-toggle-bot-projects"));
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  expect(screen.getByTestId("sidebar-show-bot-projects").getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByTestId("sidebar-show-bot-projects"));
  expect(useBotProjectsPreference.getState().showBotProjects).toBe(false);
});
it("renders no new toggle when the feature is unavailable", () => {
  env.enabled = false;
  const { container } = render(
    <>
      <BotProjectsToggle />
      <BotProjectsToggle menu />
    </>,
  );
  expect(container.innerHTML).toBe("");
});
it("collapses and restores the shared cowork group without touching visibility", () => {
  render(
    <BotProjectsGroup>
      <span>Existing renderer</span>
    </BotProjectsGroup>,
  );
  fireEvent.click(screen.getByTestId("sidebar-bot-projects-group"));
  expect(screen.queryByText("Existing renderer")).toBeNull();
  expect(screen.getByTestId("collapsed-chevron")).toBeTruthy();
  expect(useBotProjectsPreference.getState().showBotProjects).toBe(false);
  fireEvent.click(screen.getByTestId("sidebar-bot-projects-group"));
  expect(screen.queryByText("Existing renderer")).not.toBeNull();
  expect(screen.getByTestId("expanded-chevron")).toBeTruthy();
});
