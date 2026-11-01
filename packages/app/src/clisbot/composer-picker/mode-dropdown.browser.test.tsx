import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { AgentMode } from "@clisbot/protocol/agent-types";
import { ComposerPickerPlacementProvider } from "@/composer/picker-placement";
import { i18n } from "@/i18n/i18next";
import { KeyboardActionDispatcherProvider } from "@/keyboard/keyboard-action-dispatcher-context";
import { ModeDropdown } from "./mode-dropdown";
import { buildComposerModeOptions } from "./mode-options";

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
vi.mock("react-native-reanimated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-native-reanimated")>()),
  FadeIn: { duration: () => undefined },
  FadeOut: { duration: () => undefined },
}));

const CODEX: AgentMode[] = [
  { id: "plan", label: "Plan", colorTier: "planning" },
  { id: "auto", label: "Default Permissions", colorTier: "moderate" },
  { id: "full-access", label: "Full Access", colorTier: "dangerous" },
];

beforeAll(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("en");
});
afterEach(() => cleanup());

function mount(showLabel: boolean, onSelectMode = vi.fn()) {
  render(
    <KeyboardActionDispatcherProvider>
      <ComposerPickerPlacementProvider value="bottom-start">
        <ModeDropdown
          provider="codex"
          providerDefinitions={[]}
          modeOptions={buildComposerModeOptions(CODEX, true)}
          selectedModeId="full-access"
          onSelectMode={onSelectMode}
          showLabel={showLabel}
          ownsCycleShortcut={false}
          testID="mode-control"
        />
      </ComposerPickerPlacementProvider>
    </KeyboardActionDispatcherProvider>,
  );
  return onSelectMode;
}

it("shows the mode's name beside its icon when there is room", async () => {
  await page.viewport(1280, 900);
  mount(true);
  expect((await screen.findByTestId("mode-control")).textContent).toBe("Full access");
});

it("collapses to the icon and still names the mode for assistive tech", async () => {
  await page.viewport(1280, 900);
  mount(false);
  const trigger = await screen.findByTestId("mode-control");
  expect(trigger.textContent).toBe("");
  expect(trigger.getAttribute("aria-label")).toBe("Select agent mode (Full access)");
});

it("lists Plan, the permissions and Full auto-accept, each with one line on what it does", async () => {
  await page.viewport(1280, 900);
  const onSelectMode = mount(true);
  await userEvent.click(await screen.findByTestId("mode-control"));
  const fullAuto = await screen.findByTestId("mode-option-full-auto-accept");
  expect(fullAuto.textContent).toContain("Full auto-accept");
  expect(fullAuto.textContent).toContain("Questions still wait for you.");
  expect((await screen.findByTestId("mode-option-plan")).textContent).toContain("Plan");
  expect((await screen.findByTestId("mode-option-auto")).textContent).toContain(
    "Default permissions",
  );
  await userEvent.click(fullAuto);
  expect(onSelectMode).toHaveBeenCalledWith("full-auto-accept");
});
