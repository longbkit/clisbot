import { useCallback, useState } from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { I18nextProvider } from "react-i18next";
import { i18n } from "@/i18n/i18next";
import {
  AgentConfigurationGrantEditor,
  createAgentConfigurationDraft,
  type AgentConfigurationDraft,
} from "./agent-configuration-grant-fields";

// Real web controls with production theme tokens; the browser configuration only
// stubs native packages and icons.
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
    useUnistyles: () => ({
      theme: lightTheme,
      rt: { breakpoint: window.innerWidth < 500 ? "xs" : "lg" },
    }),
  };
});

const CATALOG = {
  providers: [
    {
      id: "claude",
      label: "Claude",
      models: [
        ["claude-opus-5", "Opus 5"],
        ["claude-fable-5-1", "Fable 5.1"],
        ["claude-sonnet-5", "Sonnet 5"],
      ].map(([id, label]) => ({ id: id!, label: label!, thinkingOptions: [] })),
    },
  ],
};
const CARD_STYLE = { width: 720, padding: 24 };

function Card() {
  const [draft, setDraft] = useState<AgentConfigurationDraft>(() => ({
    ...createAgentConfigurationDraft(),
    providerId: "claude",
    modelIds: ["claude-opus-5"],
    thinkingOptionIds: "*",
  }));
  const setConfigurations = useCallback(
    (update: (current: AgentConfigurationDraft[]) => AgentConfigurationDraft[]) =>
      setDraft((current) => update([current])[0] ?? current),
    [],
  );
  return (
    <div style={CARD_STYLE}>
      <AgentConfigurationGrantEditor
        index={0}
        catalog={CATALOG}
        value={draft}
        disabled={false}
        canRemove
        setConfigurations={setConfigurations}
      />
    </div>
  );
}

// Guards the picker against its first shape: no Done band or buttons beside the
// trigger, the list stays open while choosing, and each choice is listed under it.
it("chooses several Models from one trigger that stays open while choosing", async () => {
  await page.viewport(1200, 800);
  render(
    <I18nextProvider i18n={i18n}>
      <Card />
    </I18nextProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Expand" }));
  await userEvent.click(screen.getByRole("button", { name: /^Models/ }));
  await expect.element(page.getByText("All available Models")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  await userEvent.click(page.getByText("Fable 5.1"));
  await expect.element(page.getByText("Sonnet 5")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Models (2 selected)" }))
    .toBeInTheDocument();
  // Each chosen Model is listed by name under the trigger, removable in place.
  await expect.element(page.getByRole("button", { name: "Remove Fable 5.1" })).toBeVisible();
  await userEvent.click(page.getByText("All available Models"));
  await expect
    .element(page.getByRole("button", { name: "Models (All available Models)" }))
    .toBeInTheDocument();
});
