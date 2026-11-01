import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { favoriteModelKey, useModelFavoritesStore } from "./favorites-store";
import type { ModelListStatus } from "./model-list";
import { buildPickerView, limitRows, resolveInitialScope, type PickerScope } from "./picker-rows";

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

/** The rail's choice, the query, and what the rail narrows the query's results to. */
function usePickerScope(input: {
  providers: readonly ProviderSelectorProvider[];
  selectedProvider: string;
  open: boolean;
  onChange: (hasQuery: boolean) => void;
}) {
  const { providers, selectedProvider, open, onChange } = input;
  const [scope, setScope] = useState(() => resolveInitialScope(providers, selectedProvider));
  const [narrow, setNarrow] = useState<PickerScope | null>(null);
  const [query, setQueryState] = useState("");
  // Bumped when the panel empties the search field itself (Profiles while searching).
  const [searchResetKey, setSearchResetKey] = useState(0);
  // Each opening starts on the current model's provider with an empty query.
  useEffect(() => {
    if (!open) return;
    setScope(resolveInitialScope(providers, selectedProvider));
    setNarrow(null);
    setQueryState("");
    onChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on opening only
  }, [open]);
  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next);
      // Clearing the query returns to the plain rail scope.
      if (!next.trim()) setNarrow(null);
      onChange(next.trim().length > 0);
    },
    [onChange],
  );
  const hasQuery = query.trim().length > 0;
  // While searching the rail filters the results; Profiles is not searchable, so it ends the
  // search and lists the profiles.
  const selectRail = useCallback(
    (next: PickerScope) => {
      setScope(next);
      if (hasQuery && next.kind === "profiles") {
        setQueryState("");
        setNarrow(null);
        setSearchResetKey((key) => key + 1);
        onChange(false);
        return;
      }
      if (hasQuery) setNarrow(next);
      onChange(hasQuery);
    },
    [hasQuery, onChange],
  );
  const clearNarrow = useCallback(() => {
    setNarrow(null);
    onChange(hasQuery);
  }, [hasQuery, onChange]);
  return { scope, narrow, query, setQuery, selectRail, clearNarrow, searchResetKey };
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
  const [expanded, setExpanded] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const selectedKey = favoriteModelKey(selectedProvider, input.selectedModelId);
  // Any change of what the list shows collapses it again; a query highlights its best match, so
  // Enter picks it.
  const resetList = useCallback((hasQuery: boolean) => {
    setExpanded(false);
    setHighlight(hasQuery ? 0 : -1);
  }, []);
  const picker = usePickerScope({ providers, selectedProvider, open, onChange: resetList });
  const { scope, narrow, query } = picker;
  const view = useMemo(
    () =>
      buildPickerView({
        providers,
        scope,
        narrow,
        query,
        favorites,
        currentProvider: selectedProvider,
      }),
    [favorites, narrow, providers, query, scope, selectedProvider],
  );
  // A broad query over a large catalog collapses behind Show more too, so the panel never
  // mounts hundreds of rows at once.
  const visible = useMemo(
    () => limitRows(view.rows, { expanded, selectedKey }),
    [view.rows, expanded, selectedKey],
  );
  const showMore = useCallback(() => setExpanded(true), []);
  return {
    ...picker,
    favorites,
    toggleFavorite,
    status: resolveStatus(providers, scope, query),
    rows: visible.rows,
    hiddenCount: visible.hiddenCount,
    grouped: view.grouped,
    highlights: view.highlights,
    counts: view.counts,
    showMore,
    highlight,
    setHighlight,
    selectedKey,
  };
}

export type ModelPickerState = ReturnType<typeof useModelPickerState>;
