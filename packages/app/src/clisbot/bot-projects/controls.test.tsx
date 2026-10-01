// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotProjectsToggle } from "./controls";
import { useBotProjectsPreference } from "./preferences";
vi.mock("react-native-unistyles", () => ({
  withUnistyles: (component: unknown) => component,
}));
vi.mock("lucide-react-native", () => ({ Bot: () => null }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));
vi.mock("@/components/ui/menu", () => ({
  MenuItem: ({
    children,
    selected,
    onSelect,
  }: {
    children: React.ReactNode;
    selected: boolean;
    onSelect: () => void;
  }) => (
    <button type="button" role="menuitemcheckbox" aria-checked={selected} onClick={onSelect}>
      {children}
    </button>
  ),
}));
beforeEach(() => {
  vi.stubGlobal("React", React);
  useBotProjectsPreference.setState({ showBotProjects: true });
});
afterEach(cleanup);
it("toggles Bot project visibility from Show and retains the choice when reopened", () => {
  const view = render(<BotProjectsToggle />);
  const option = screen.getByRole("menuitemcheckbox", { name: "Bot projects" });
  expect(option.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(option);
  expect(option.getAttribute("aria-checked")).toBe("false");
  expect(useBotProjectsPreference.getState().showBotProjects).toBe(false);
  view.unmount();
  render(<BotProjectsToggle />);
  const reopened = screen.getByRole("menuitemcheckbox", {
    name: "Bot projects",
  });
  expect(reopened.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(reopened);
  expect(reopened.getAttribute("aria-checked")).toBe("true");
});
