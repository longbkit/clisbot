// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotProjectsGroup, BotProjectsToggle } from "./controls";
import { useBotProjectsPreference } from "./preferences";
vi.mock("react-native", () => ({ View: "div" }));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock("@/clisbot/bots/sidebar/section-header", () => ({
  BotsSectionHeader: ({
    label,
    collapsed,
    onToggle,
  }: {
    label: string;
    collapsed: boolean;
    onToggle: () => void;
  }) => (
    <button type="button" aria-expanded={!collapsed} onClick={onToggle}>
      {label}
    </button>
  ),
}));
beforeEach(() => {
  vi.stubGlobal("React", React);
  useBotProjectsPreference.setState({ botProjectsCollapsed: true });
});
afterEach(cleanup);
it("keeps the section visible, starts collapsed, and respects the user's expansion", () => {
  const view = render(
    <BotProjectsGroup>
      <span>Bot workspace</span>
    </BotProjectsGroup>,
  );
  expect(screen.queryByText("Bot workspace")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Bot projects" }));
  expect(screen.getByText("Bot workspace")).toBeTruthy();
  view.unmount();
  render(
    <BotProjectsGroup>
      <span>Bot workspace</span>
    </BotProjectsGroup>,
  );
  expect(screen.getByText("Bot workspace")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Bot projects" }));
  expect(screen.queryByText("Bot workspace")).toBeNull();
});
it("removes both obsolete visibility toggles", () => {
  const { container } = render(
    <>
      <BotProjectsToggle />
      <BotProjectsToggle menu />
    </>,
  );
  expect(container.childElementCount).toBe(0);
});
