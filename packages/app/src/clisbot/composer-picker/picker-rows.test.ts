import { describe, expect, it } from "vitest";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import {
  buildRailItems,
  buildPickerView,
  limitRows,
  resolveInitialScope,
  shortcutDigit,
} from "./picker-rows";

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
        modelId: model.toLowerCase().replace(/\s+/g, "-"),
        modelLabel: model,
      })),
    },
  };
}

const PROVIDERS = [
  provider("claude", "Claude", ["Claude Opus 5.5", "Claude Sonnet 5", "Claude Haiku 5"]),
  provider("codex", "Codex", ["GPT-6-Astra", "GPT-6.1-Sol", "GPT-5.4-mini"]),
];

function labels(rows: { modelLabel: string }[]): string[] {
  return rows.map((row) => row.modelLabel);
}

function buildVisibleRows(input: {
  providers: readonly ProviderSelectorProvider[];
  scope: Parameters<typeof buildPickerView>[0]["scope"];
  query: string;
  favorites: readonly string[];
  narrow?: Parameters<typeof buildPickerView>[0]["narrow"];
  currentProvider?: string;
}) {
  return buildPickerView({ narrow: null, currentProvider: "", ...input }).rows;
}

describe("picker rail", () => {
  it("leads with Favorites and lists each provider", () => {
    expect(buildRailItems(PROVIDERS, { hasProfiles: false }).map((item) => item.key)).toEqual([
      "favorites",
      "provider:claude",
      "provider:codex",
    ]);
  });

  it("adds Profiles last when the host has them", () => {
    expect(buildRailItems(PROVIDERS, { hasProfiles: true }).at(-1)?.key).toBe("profiles");
  });

  it("opens on the current model's provider", () => {
    expect(resolveInitialScope(PROVIDERS, "codex")).toEqual({
      kind: "provider",
      providerId: "codex",
    });
    expect(resolveInitialScope(PROVIDERS, "")).toEqual({ kind: "provider", providerId: "claude" });
  });
});

describe("picker rows", () => {
  it("lists the chosen provider's models without a query", () => {
    const rows = buildVisibleRows({
      providers: PROVIDERS,
      scope: { kind: "provider", providerId: "codex" },
      query: "",
      favorites: [],
    });
    expect(labels(rows)).toEqual(["GPT-6-Astra", "GPT-6.1-Sol", "GPT-5.4-mini"]);
  });

  it("searches every provider, whatever the rail shows", () => {
    const rows = buildVisibleRows({
      providers: PROVIDERS,
      scope: { kind: "provider", providerId: "claude" },
      query: "so",
      favorites: [],
    });
    expect(labels(rows)).toEqual(["Claude Sonnet 5", "GPT-6.1-Sol"]);
  });

  it("matches a provider name and lists all its models", () => {
    const rows = buildVisibleRows({
      providers: PROVIDERS,
      scope: { kind: "provider", providerId: "claude" },
      query: "codex",
      favorites: [],
    });
    expect(labels(rows)).toEqual(["GPT-6-Astra", "GPT-6.1-Sol", "GPT-5.4-mini"]);
  });

  it("groups a query's results by provider and counts each rail entry's matches", () => {
    const view = buildPickerView({
      providers: PROVIDERS,
      scope: { kind: "provider", providerId: "claude" },
      narrow: null,
      query: "5",
      favorites: ["codex:GPT-5.4-mini"],
      currentProvider: "claude",
    });
    expect(view.grouped).toBe(true);
    expect(labels(view.rows)).toEqual([
      "Claude Opus 5.5",
      "Claude Sonnet 5",
      "Claude Haiku 5",
      "GPT-5.4-mini",
    ]);
    expect(Object.fromEntries(view.counts ?? [])).toEqual({
      "provider:claude": 3,
      "provider:codex": 1,
      favorites: 1,
    });
  });

  it("puts the provider with the better match first", () => {
    const rows = buildVisibleRows({
      providers: PROVIDERS,
      scope: { kind: "provider", providerId: "claude" },
      query: "gpt 6",
      favorites: [],
      currentProvider: "claude",
    });
    expect(labels(rows)).toEqual(["GPT-6-Astra", "GPT-6.1-Sol"]);
  });

  it("narrows a query to the provider or the favourites the rail picks", () => {
    const toCodex = buildPickerView({
      providers: PROVIDERS,
      scope: { kind: "provider", providerId: "codex" },
      narrow: { kind: "provider", providerId: "codex" },
      query: "so",
      favorites: [],
      currentProvider: "claude",
    });
    expect(toCodex.grouped).toBe(false);
    expect(labels(toCodex.rows)).toEqual(["GPT-6.1-Sol"]);
    const toFavorites = buildVisibleRows({
      providers: PROVIDERS,
      scope: { kind: "favorites" },
      narrow: { kind: "favorites" },
      query: "so",
      favorites: ["claude:Claude Sonnet 5"],
    });
    expect(labels(toFavorites)).toEqual(["Claude Sonnet 5"]);
  });

  it("shows favourites from every provider", () => {
    const rows = buildVisibleRows({
      providers: PROVIDERS,
      scope: { kind: "favorites" },
      query: "",
      favorites: ["codex:GPT-6-Astra", "claude:Claude Haiku 5"],
    });
    expect(labels(rows)).toEqual(["Claude Haiku 5", "GPT-6-Astra"]);
  });

  it("collapses a long list behind Show more, but never hides the selected model", () => {
    const rows = buildVisibleRows({
      providers: [provider("x", "X", ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"])],
      scope: { kind: "provider", providerId: "x" },
      query: "",
      favorites: [],
    });
    expect(limitRows(rows, { expanded: false, selectedKey: "x:b" })).toMatchObject({
      hiddenCount: 2,
    });
    expect(limitRows(rows, { expanded: false, selectedKey: "x:j" }).hiddenCount).toBe(0);
    expect(limitRows(rows, { expanded: true, selectedKey: "" }).rows).toHaveLength(10);
  });

  it("numbers the first nine rows for shortcuts", () => {
    expect(shortcutDigit(0)).toBe("1");
    expect(shortcutDigit(8)).toBe("9");
    expect(shortcutDigit(9)).toBeNull();
  });
});
