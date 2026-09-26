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
vi.mock("react-native", () => ({
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
  fireEvent.click(screen.getByTestId("sidebar-toggle-bot-projects"));
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
  expect(useBotProjectsPreference.getState().showBotProjects).toBe(false);
  fireEvent.click(screen.getByTestId("sidebar-bot-projects-group"));
  expect(screen.queryByText("Existing renderer")).not.toBeNull();
});
