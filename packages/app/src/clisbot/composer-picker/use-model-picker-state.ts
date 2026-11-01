import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { favoriteModelKey, useModelFavoritesStore } from "./favorites-store";
import type { ModelListStatus } from "./model-list";
import { buildVisibleRows, limitRows, resolveInitialScope, type PickerScope } from "./picker-rows";

function resolveStatus(
  providers: readonly ProviderSelectorProvider[],
  scope: PickerScope,
  query: string,
): ModelListStatus {
  if (query.trim() || scope.kind !== "provider") return "ready";
  const selection = providers.find((entry) => entry.id === scope.providerId)?.modelSelection;
  if (selection?.kind === "loading") return "loading";
  return selection?.kind === "error" ? { error: selection.message } : "ready";
}

/** The panel's view state: rail scope, query, Show more, keyboard highlight and favourites. */
export function useModelPickerState(input: {
  providers: readonly ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModelId: string;
  open: boolean;
}) {
  const { providers, selectedProvider, open } = input;
  const favorites = useModelFavoritesStore((state) => state.keys);
  const toggleFavorite = useModelFavoritesStore((state) => state.toggle);
  const [scope, setScopeState] = useState(() => resolveInitialScope(providers, selectedProvider));
  const [query, setQueryState] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const selectedKey = favoriteModelKey(selectedProvider, input.selectedModelId);
  const setScope = useCallback((next: PickerScope) => {
    setScopeState(next);
    setExpanded(false);
    setHighlight(-1);
  }, []);
  // Each opening starts on the current model's provider with an empty query.
  useEffect(() => {
    if (!open) return;
    setScope(resolveInitialScope(providers, selectedProvider));
    setQueryState("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on opening only
  }, [open]);
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setHighlight(next.trim() ? 0 : -1);
  }, []);
  const all = useMemo(
    () => buildVisibleRows({ providers, scope, query, favorites }),
    [favorites, providers, query, scope],
  );
  const visible = useMemo(
    () => limitRows(all, { expanded: expanded || query.trim().length > 0, selectedKey }),
    [all, expanded, query, selectedKey],
  );
  const showMore = useCallback(() => setExpanded(true), []);
  const status = resolveStatus(providers, scope, query);
  const { rows, hiddenCount } = visible;
  return {
    favorites,
    toggleFavorite,
    scope,
    setScope,
    query,
    setQuery,
    status,
    rows,
    hiddenCount,
    showMore,
    highlight,
    setHighlight,
    selectedKey,
  };
}

export type ModelPickerState = ReturnType<typeof useModelPickerState>;
