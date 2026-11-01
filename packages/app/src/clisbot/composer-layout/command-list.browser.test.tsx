import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { Autocomplete, type AutocompleteOption } from "@/components/ui/autocomplete";
import { i18n } from "@/i18n/i18next";

vi.mock("react-native-unistyles", async () => {
  const { lightTheme } = await import("@/styles/theme");
  const { StyleSheet } = await import("react-native");
  return {
    StyleSheet: {
      ...StyleSheet,
      create: <T,>(styles: T | ((theme: typeof lightTheme) => T)): T =>
        typeof styles === "function"
          ? (styles as (theme: typeof lightTheme) => T)(lightTheme)
          : styles,
    },
    withUnistyles: <T,>(component: T): T => component,
    UnistylesRuntime: { breakpoint: "lg" },
    useUnistyles: () => ({ theme: lightTheme, rt: { breakpoint: "lg" } }),
  };
});

beforeAll(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("en");
});
afterEach(() => cleanup());

const OPTIONS: AutocompleteOption[] = [
  { id: "review", label: "/review", description: "Review the current changes", kind: "command" },
  {
    id: "handoff",
    label: "/handoff",
    detail: "[agent]",
    description: "Prepare a handoff note",
    kind: "command",
  },
  { id: "exit", label: "/exit", description: "Archive the current agent", kind: "command" },
];

it("lists each command once, with no card repeating the highlighted row", () => {
  const { container } = render(
    <Autocomplete options={OPTIONS} selectedIndex={2} onSelect={vi.fn()} />,
  );
  const text = container.textContent ?? "";
  expect(text.split("/exit").length - 1).toBe(1);
  expect(text.split("Archive the current agent").length - 1).toBe(1);
});

it("names a command's arguments in its row", () => {
  render(<Autocomplete options={OPTIONS} selectedIndex={0} onSelect={vi.fn()} />);
  expect(screen.getByText("[agent]")).toBeTruthy();
});
