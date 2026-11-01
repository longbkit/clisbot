import { getNextActiveIndex } from "@/components/ui/combobox-keyboard";
import type {
  ProviderSelectionModelRow,
  ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";

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

function matchesQuery(row: ProviderSelectionModelRow, query: string): boolean {
  return [row.modelLabel, row.modelId, row.providerLabel, row.provider].some((field) =>
    field.toLowerCase().includes(query),
  );
}

/** A query searches every provider, model names and provider names alike. */
export function buildVisibleRows(input: {
  providers: readonly ProviderSelectorProvider[];
  scope: PickerScope;
  query: string;
  favorites: readonly string[];
}): ProviderSelectionModelRow[] {
  const all = input.providers.flatMap(providerRows);
  const query = input.query.trim().toLowerCase();
  if (query) return all.filter((row) => matchesQuery(row, query));
  const { scope } = input;
  if (scope.kind === "favorites")
    return all.filter((row) => input.favorites.includes(row.favoriteKey));
  if (scope.kind === "provider") return all.filter((row) => row.provider === scope.providerId);
  return [];
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
