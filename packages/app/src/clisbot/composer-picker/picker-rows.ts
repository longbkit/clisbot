import { getNextActiveIndex } from "@/components/ui/combobox-keyboard";
import type {
  ProviderSelectionModelRow,
  ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { parseSearchQuery, searchRows, type RankedRow, type TextRange } from "./picker-search";

/** What the rail has chosen: Favorites, one provider, or the Host's Agent profiles. */
export type PickerScope =
  | { kind: "favorites" }
  | { kind: "provider"; providerId: string }
  | { kind: "profiles" };

export interface PickerRailItem {
  key: string;
  scope: PickerScope;
  /** The provider's name; Favorites and Profiles are named by the app. */
  label: string | null;
}

/** Rows shown before "Show more". Nine keep every row on a ⌘ shortcut. */
export const COLLAPSED_ROW_LIMIT = 8;

export function scopeKey(scope: PickerScope): string {
  return scope.kind === "provider" ? `provider:${scope.providerId}` : scope.kind;
}

export function buildRailItems(
  providers: readonly ProviderSelectorProvider[],
  options: { hasProfiles: boolean },
): PickerRailItem[] {
  const favorites: PickerRailItem = { key: "favorites", scope: { kind: "favorites" }, label: null };
  const providerItems = providers.map<PickerRailItem>((provider) => ({
    key: scopeKey({ kind: "provider", providerId: provider.id }),
    scope: { kind: "provider", providerId: provider.id },
    label: provider.label,
  }));
  const profiles: PickerRailItem[] = options.hasProfiles
    ? [{ key: "profiles", scope: { kind: "profiles" }, label: null }]
    : [];
  return [favorites, ...providerItems, ...profiles];
}

/** The picker opens on the current model's provider, so the check is on screen. */
export function resolveInitialScope(
  providers: readonly ProviderSelectorProvider[],
  selectedProvider: string,
): PickerScope {
  const current = providers.find((provider) => provider.id === selectedProvider) ?? providers[0];
  return current ? { kind: "provider", providerId: current.id } : { kind: "favorites" };
}

function providerRows(provider: ProviderSelectorProvider): ProviderSelectionModelRow[] {
  return provider.modelSelection.kind === "models" ? provider.modelSelection.rows : [];
}

/** What the list shows: the rail's choice, or search results with their marks and counts. */
export interface PickerView {
  rows: ProviderSelectionModelRow[];
  /** Search results across providers: a header names each provider's run of rows. */
  grouped: boolean;
  /** The matched characters of each row's model label, by `favoriteKey`, while searching. */
  highlights: ReadonlyMap<string, TextRange[]>;
  /** Matches per rail entry (`PickerRailItem.key`) while searching; null without a query. */
  counts: ReadonlyMap<string, number> | null;
}

const NO_HIGHLIGHTS: ReadonlyMap<string, TextRange[]> = new Map();

function scopedRows(
  all: readonly ProviderSelectionModelRow[],
  scope: PickerScope,
  favorites: readonly string[],
): ProviderSelectionModelRow[] {
  if (scope.kind === "favorites") return all.filter((row) => favorites.includes(row.favoriteKey));
  if (scope.kind === "provider") return all.filter((row) => row.provider === scope.providerId);
  return [];
}

function countMatches(
  ranked: readonly RankedRow[],
  favorites: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  function add(key: string) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const { row } of ranked) {
    add(scopeKey({ kind: "provider", providerId: row.provider }));
    if (favorites.includes(row.favoriteKey)) add("favorites");
  }
  return counts;
}

/**
 * Results from every provider, a run per provider. The runs follow the rail's order, except
 * that a provider with a better match comes first, and on a tie the current provider: the first
 * row is always the best match, so Enter picks it.
 */
function groupByProvider(input: {
  ranked: readonly RankedRow[];
  providerOrder: readonly string[];
  currentProvider: string;
}): ProviderSelectionModelRow[] {
  const groups = input.providerOrder.flatMap((providerId, railIndex) => {
    const entries = input.ranked.filter((entry) => entry.row.provider === providerId);
    const best = entries[0];
    if (!best) return [];
    const current = providerId === input.currentProvider ? 0 : 1;
    return [{ entries, tier: best.match.tier, current, railIndex }];
  });
  groups.sort((a, b) => a.tier - b.tier || a.current - b.current || a.railIndex - b.railIndex);
  return groups.flatMap((group) => group.entries.map((entry) => entry.row));
}

function narrowRanked(
  ranked: readonly RankedRow[],
  narrow: PickerScope,
  favorites: readonly string[],
): RankedRow[] {
  if (narrow.kind === "favorites") {
    return ranked.filter((entry) => favorites.includes(entry.row.favoriteKey));
  }
  if (narrow.kind === "provider") {
    return ranked.filter((entry) => entry.row.provider === narrow.providerId);
  }
  return [];
}

/**
 * Without a query the rail's choice. A query searches every provider, model names and provider
 * names alike, and the rail filters it: `narrow` keeps one provider's or the favourites' matches.
 */
export function buildPickerView(input: {
  providers: readonly ProviderSelectorProvider[];
  scope: PickerScope;
  narrow: PickerScope | null;
  query: string;
  favorites: readonly string[];
  currentProvider: string;
}): PickerView {
  const all = input.providers.flatMap(providerRows);
  const query = parseSearchQuery(input.query);
  if (query.tokens.length === 0) {
    const rows = scopedRows(all, input.scope, input.favorites);
    return { rows, grouped: false, highlights: NO_HIGHLIGHTS, counts: null };
  }
  const ranked = searchRows({
    rows: all,
    query,
    currentProvider: input.currentProvider,
    favorites: input.favorites,
  });
  const highlights = new Map(ranked.map((entry) => [entry.row.favoriteKey, entry.match.ranges]));
  const counts = countMatches(ranked, input.favorites);
  if (input.narrow) {
    const rows = narrowRanked(ranked, input.narrow, input.favorites).map((entry) => entry.row);
    return { rows, grouped: false, highlights, counts };
  }
  const rows = groupByProvider({
    ranked,
    providerOrder: input.providers.map((provider) => provider.id),
    currentProvider: input.currentProvider,
  });
  return { rows, grouped: true, highlights, counts };
}

/** Collapses a long list behind "Show more", stretching it to keep the selected row shown. */
export function limitRows(
  rows: readonly ProviderSelectionModelRow[],
  options: { expanded: boolean; selectedKey: string },
): { rows: ProviderSelectionModelRow[]; hiddenCount: number } {
  if (options.expanded || rows.length <= COLLAPSED_ROW_LIMIT + 1) {
    return { rows: [...rows], hiddenCount: 0 };
  }
  const selectedIndex = rows.findIndex((row) => row.favoriteKey === options.selectedKey);
  const limit = Math.max(COLLAPSED_ROW_LIMIT, selectedIndex + 1);
  return { rows: rows.slice(0, limit), hiddenCount: rows.length - limit };
}

/** ⌘1…⌘9 pick the first nine visible rows. */
export function shortcutDigit(index: number): string | null {
  return index >= 0 && index < 9 ? String(index + 1) : null;
}

export function moveHighlight(index: number, count: number, key: "ArrowDown" | "ArrowUp") {
  return getNextActiveIndex({ currentIndex: index, itemCount: count, key });
}
