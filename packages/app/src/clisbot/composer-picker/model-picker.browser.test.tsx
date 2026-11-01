import React, { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { AgentFeature } from "@clisbot/protocol/agent-types";
import { ComposerPickerPlacementProvider } from "@/composer/picker-placement";
import { i18n } from "@/i18n/i18next";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { useModelFavoritesStore } from "./favorites-store";
import { ModelPicker, type ModelPickerProps } from "./model-picker";
import { resolvePanelFeatures } from "./speed";

// The Combobox reads the real theme; the shared test stub carries only a few colours.
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

// A keyboard focus opens tooltips, whose web fade cannot run in this harness.
vi.mock("react-native-reanimated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-native-reanimated")>()),
  FadeIn: { duration: () => undefined },
  FadeOut: { duration: () => undefined },
}));

function provider(id: string, label: string, models: string[]): ProviderSelectorProvider {
  return {
    id,
    label,
    modelSelection: {
      kind: "models",
      rows: models.map((model) => ({
        favoriteKey: `${id}:${model}`,
        provider: id,
        providerLabel: label,
        modelId: model,
        modelLabel: model,
      })),
    },
  };
}

const PROVIDERS = [
  provider("claude", "Claude", ["Claude Opus 5.5", "Claude Sonnet 5", "Claude Haiku 5"]),
  provider("codex", "Codex", ["GPT-6-Astra", "GPT-6.1-Sol", "GPT-5.4-mini"]),
];

const CODEX_SPEED: AgentFeature = {
  type: "select",
  id: "service_tier",
  label: "Speed",
  value: "default",
  options: [
    { id: "default", label: "Normal", isDefault: true },
    { id: "fast", label: "Fast" },
  ],
};

interface Calls {
  picks: Array<[string, string]>;
  efforts: string[];
  features: Array<[string, unknown]>;
  openChanges: boolean[];
}

const EFFORTS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium", isDefault: true },
  { id: "high", label: "High" },
];

function Harness({ calls, features: initial }: { calls: Calls; features?: AgentFeature[] }) {
  const anchorRef = useRef<View | null>(null);
  const [selected, setSelected] = useState({ provider: "codex", model: "GPT-6-Astra" });
  const [features, setFeatures] = useState(initial ?? []);
  const panel = resolvePanelFeatures(features, { fullAutoAcceptSupported: true });
  const pick = useCallback<ModelPickerProps["onPickModel"]>(
    (providerId, model) => {
      calls.picks.push([providerId, model]);
      setSelected({ provider: providerId, model });
    },
    [calls],
  );
  const setFeature = useCallback(
    (featureId: string, value: unknown) => {
      calls.features.push([featureId, value]);
      setFeatures((current) =>
        current.map((feature) =>
          feature.id === featureId ? ({ ...feature, value } as AgentFeature) : feature,
        ),
      );
    },
    [calls],
  );
  const openChange = useCallback((open: boolean) => calls.openChanges.push(open), [calls]);
  const reasoning = useMemo(
    () => ({
      modelName: selected.model,
      options: EFFORTS,
      selectedId: "medium",
      onSelect: (id: string) => calls.efforts.push(id),
    }),
    [calls, selected.model],
  );
  return (
    <>
      <View ref={anchorRef}>
        <Text>anchor</Text>
      </View>
      <ModelPicker
        open
        onOpenChange={openChange}
        anchorRef={anchorRef}
        isCompact={false}
        providers={PROVIDERS}
        selectedProvider={selected.provider}
        selectedModelId={selected.model}
        serverId={null}
        onPickModel={pick}
        reasoning={reasoning}
        speed={panel.speed}
        moreFeatures={panel.more}
        onSetFeature={setFeature}
        mode={null}
        profiles={null}
      />
    </>
  );
}

function newCalls(): Calls {
  return { picks: [], efforts: [], features: [], openChanges: [] };
}

function mount(initial?: AgentFeature[]): Calls {
  const calls = newCalls();
  // The composer opens pickers upward; this anchor sits at the top, so the panel opens down.
  render(
    <ComposerPickerPlacementProvider value="bottom-start">
      <Harness calls={calls} features={initial} />
    </ComposerPickerPlacementProvider>,
  );
  return calls;
}

beforeAll(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("en");
});
beforeEach(async () => {
  await page.viewport(1280, 900);
  useModelFavoritesStore.setState({ keys: [] });
});
afterEach(() => {
  cleanup();
});

function modelRow(key: string) {
  return screen.findByTestId(`composer-picker-model-${key}`);
}

async function search(text: string) {
  const field = await screen.findByTestId("composer-picker-search");
  await userEvent.fill(field, text);
}

it("stays open after picking a model and closes on Escape", async () => {
  const calls = mount();
  await userEvent.click(await modelRow("codex:GPT-6.1-Sol"));
  expect(calls.picks).toEqual([["codex", "GPT-6.1-Sol"]]);
  expect(screen.getByTestId("composer-picker-panel")).toBeTruthy();
  expect(calls.openChanges).toEqual([]);
  await userEvent.keyboard("{Escape}");
  expect(calls.openChanges).toEqual([false]);
});

it("searches every provider and matches provider names", async () => {
  mount();
  await search("so");
  expect(await modelRow("claude:Claude Sonnet 5")).toBeTruthy();
  expect(await modelRow("codex:GPT-6.1-Sol")).toBeTruthy();
  expect(screen.queryByTestId("composer-picker-model-codex:GPT-6-Astra")).toBeNull();
  await search("claude");
  expect(await modelRow("claude:Claude Haiku 5")).toBeTruthy();
  expect(screen.queryByTestId("composer-picker-model-codex:GPT-6.1-Sol")).toBeNull();
});

it("picks the Nth row with the ⌘ shortcut", async () => {
  const calls = mount();
  await modelRow("codex:GPT-5.4-mini");
  const mod = getShortcutOs() === "mac" ? "Meta" : "Control";
  await userEvent.keyboard(`{${mod}>}3{/${mod}}`);
  expect(calls.picks).toEqual([["codex", "GPT-5.4-mini"]]);
});

it("stars a model and lists it under Favorites", async () => {
  useModelFavoritesStore.setState({ keys: ["claude:Claude Haiku 5"] });
  mount();
  // The star shows on hover (docs/hover.md).
  await userEvent.hover(await modelRow("codex:GPT-5.4-mini"));
  await userEvent.click(await screen.findByTestId("composer-picker-favorite-codex:GPT-5.4-mini"));
  expect(useModelFavoritesStore.getState().keys).toEqual([
    "claude:Claude Haiku 5",
    "codex:GPT-5.4-mini",
  ]);
  await userEvent.click(await screen.findByTestId("composer-picker-rail-favorites"));
  expect(await modelRow("claude:Claude Haiku 5")).toBeTruthy();
  expect(await modelRow("codex:GPT-5.4-mini")).toBeTruthy();
  expect(screen.queryByTestId("composer-picker-model-codex:GPT-6.1-Sol")).toBeNull();
  expect(screen.getAllByLabelText("Remove from favorites")).toHaveLength(2);
});

it("shows the selected model's reasoning with its default marked", async () => {
  const calls = mount();
  const column = await screen.findByTestId("composer-picker-reasoning");
  expect(column.textContent).toContain("GPT-6-Astra");
  expect(column.textContent).toContain("Default");
  await userEvent.click(await modelRow("codex:GPT-6.1-Sol"));
  expect(screen.getByTestId("composer-picker-reasoning").textContent).toContain("GPT-6.1-Sol");
  await userEvent.click(await screen.findByTestId("composer-picker-effort-high"));
  expect(calls.efforts).toEqual(["high"]);
});

it("switches to Fast and warns that it costs more", async () => {
  const calls = mount([CODEX_SPEED]);
  expect(screen.queryByText("Higher cost")).toBeNull();
  await userEvent.click(await screen.findByTestId("composer-picker-fast"));
  expect(calls.features).toEqual([["service_tier", "fast"]]);
  expect(await screen.findByText("Higher cost")).toBeTruthy();
  expect(calls.openChanges).toEqual([]);
});
