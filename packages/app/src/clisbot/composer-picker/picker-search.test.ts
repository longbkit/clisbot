import { describe, expect, it } from "vitest";
import type { ProviderSelectionModelRow } from "@/provider-selection/provider-selection";
import { splitLabel } from "./highlighted-label";
import {
  MATCH_EXACT,
  MATCH_PREFIX,
  MATCH_SUBSTRING,
  MATCH_WORD_PREFIX,
  matchRow,
  parseSearchQuery,
  searchRows,
} from "./picker-search";

function row(provider: string, modelLabel: string, modelId?: string): ProviderSelectionModelRow {
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
  return {
    favoriteKey: `${provider}:${modelLabel}`,
    provider,
    providerLabel,
    modelId: modelId ?? modelLabel.toLowerCase().replace(/\s+/g, "-"),
    modelLabel,
  };
}

const CATALOG = [
  row("claude", "Claude Opus 5.5", "claude-opus-5-5"),
  row("claude", "Claude Sonnet 5", "claude-sonnet-5"),
  row("codex", "GPT-6-Astra", "gpt-6-astra"),
  row("codex", "GPT-6.1-Sol", "gpt-6.1-sol"),
  row("codex", "GPT-5.4-mini", "gpt-5.4-mini"),
  row("codex", "GPT-5.6-Sol", "gpt-5-6-sol"),
  row("other", "Qwen3 Max", "qwen3-max"),
  row("other", "Café Turbo", "cafe-turbo"),
  row("other", "Mô hình Đặc biệt", "mo-hinh-dac-biet"),
];

function search(query: string, options?: { currentProvider?: string; favorites?: string[] }) {
  return searchRows({
    rows: CATALOG,
    query: parseSearchQuery(query),
    currentProvider: options?.currentProvider ?? "",
    favorites: options?.favorites ?? [],
  }).map((entry) => entry.row.modelLabel);
}

describe("model search", () => {
  it.each([
    ["gpt 6", ["GPT-6-Astra", "GPT-6.1-Sol"]],
    ["gpt6", ["GPT-6-Astra", "GPT-6.1-Sol"]],
    ["gpt-6", ["GPT-6-Astra", "GPT-6.1-Sol"]],
    ["GPT-6.1", ["GPT-6.1-Sol"]],
    ["6 sol", ["GPT-6.1-Sol"]],
    ["sol 6", ["GPT-6.1-Sol"]],
    ["opus 5.5", ["Claude Opus 5.5"]],
    ["opus55", ["Claude Opus 5.5"]],
    ["cafe", ["Café Turbo"]],
    ["CAFÉ tur", ["Café Turbo"]],
    ["dac biet", ["Mô hình Đặc biệt"]],
    ["g", ["GPT-6-Astra", "GPT-6.1-Sol", "GPT-5.4-mini", "GPT-5.6-Sol"]],
    ["gp", ["GPT-6-Astra", "GPT-6.1-Sol", "GPT-5.4-mini", "GPT-5.6-Sol"]],
    ["gpt 9", []],
    // A number matches where it starts: the 6 of 5.6 and the 1 of 6.1 are not numbers.
    ["6", ["GPT-6-Astra", "GPT-6.1-Sol"]],
    ["gpt 1", []],
    ["5.6", ["GPT-5.6-Sol"]],
    ["5.6-sol", ["GPT-5.6-Sol"]],
    ["gpt 5.6", ["GPT-5.6-Sol"]],
    ["gpt-5-6", ["GPT-5.6-Sol"]],
    ["56", ["GPT-5.6-Sol"]],
    ["3", ["Qwen3 Max"]],
  ])("%s finds %j", (query, expected) => {
    expect(search(query)).toEqual(expected);
  });

  it("matches the provider's name too", () => {
    expect(search("codex")).toEqual(["GPT-6-Astra", "GPT-6.1-Sol", "GPT-5.4-mini", "GPT-5.6-Sol"]);
    expect(search("codex mini")).toEqual(["GPT-5.4-mini"]);
  });

  it("ranks exact, then prefix, then word prefix, then inside a word", () => {
    const rows = [row("x", "Mini Sol"), row("x", "Parasol"), row("x", "Solar X"), row("x", "Sol")];
    const query = parseSearchQuery("sol");
    expect(rows.map((entry) => matchRow(entry, query)?.tier)).toEqual([
      MATCH_WORD_PREFIX,
      MATCH_SUBSTRING,
      MATCH_PREFIX,
      MATCH_EXACT,
    ]);
    const ranked = searchRows({ rows, query, currentProvider: "", favorites: [] });
    expect(ranked.map((entry) => entry.row.modelLabel)).toEqual([
      "Sol",
      "Solar X",
      "Mini Sol",
      "Parasol",
    ]);
  });

  it("puts the current provider, then favourites, first on a tie", () => {
    expect(search("5", { currentProvider: "codex" })).toEqual([
      "GPT-5.4-mini",
      "GPT-5.6-Sol",
      "Claude Opus 5.5",
      "Claude Sonnet 5",
    ]);
    expect(search("5", { favorites: ["claude:Claude Sonnet 5"] })).toEqual([
      "Claude Sonnet 5",
      "Claude Opus 5.5",
      "GPT-5.4-mini",
      "GPT-5.6-Sol",
    ]);
  });

  it("marks the matched characters of the label", () => {
    const sol = CATALOG[3];
    const match = matchRow(sol, parseSearchQuery("gpt 6"));
    expect(match?.ranges).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 5 },
    ]);
    expect(splitLabel(sol.modelLabel, match?.ranges ?? [])).toEqual([
      { start: 0, text: "GPT", matched: true },
      { start: 3, text: "-", matched: false },
      { start: 4, text: "6", matched: true },
      { start: 5, text: ".1-Sol", matched: false },
    ]);
    const cafe = matchRow(row("other", "Café Turbo"), parseSearchQuery("cafe"));
    expect(cafe?.ranges).toEqual([{ start: 0, end: 4 }]);
    const opus = matchRow(CATALOG[0], parseSearchQuery("opus 5.5"));
    expect(opus?.ranges).toEqual([
      { start: 7, end: 11 },
      { start: 12, end: 13 },
      { start: 14, end: 15 },
    ]);
  });

  it("reads an empty or separator-only query as no query", () => {
    expect(parseSearchQuery("  -. ").tokens).toEqual([]);
    expect(matchRow(CATALOG[0], parseSearchQuery(""))).toBeNull();
  });
});
