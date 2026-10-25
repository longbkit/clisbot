import { useMemo } from "react";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import type { SearchViewContext } from "./candidates";
import type { SearchScopeCatalog } from "./catalog";
import { projectNameKey, type SearchScopeChip } from "./model";
import { usePublishedViewFilter, type PublishedViewFilter } from "./work-navigation";

/**
 * One filter in catalog terms. Hosts the reader cannot see and projects no Host carries drop out,
 * so a stale persisted filter never ranks or labels anything.
 */
export function resolveViewContext(
  filter: PublishedViewFilter,
  catalog: SearchScopeCatalog,
): SearchViewContext | null {
  const serverIds = (filter.serverIds ?? []).filter((id) => catalog.hostById.has(id));
  const projectKeys = [
    ...new Set([
      ...(filter.projectViewKeys ?? []).flatMap(
        (key) => catalog.projectKeyByViewKey.get(key) ?? [],
      ),
      ...(filter.projectNames ?? [])
        .map(projectNameKey)
        .filter((key) => catalog.projectByKey.has(key)),
    ]),
  ];
  const ownership = filter.ownership ?? null;
  // An unfiltered list showing everyone's work hides nothing and ranks nothing.
  if (!serverIds.length && !projectKeys.length && (ownership === null || ownership === "all")) {
    return null;
  }
  const label =
    filter.label ??
    [
      ...serverIds.map((id) => catalog.hostById.get(id)?.label ?? id),
      ...projectKeys.map((key) => catalog.projectByKey.get(key)?.label ?? key),
    ].join(" · ");
  return {
    label,
    serverIds: serverIds.length ? new Set(serverIds) : null,
    projectKeys: projectKeys.length ? new Set(projectKeys) : null,
    ownership,
    suggest: filter.suggest ?? true,
  };
}

/**
 * The list filter search ranks by (R1): what Navigation V2's Work list published, else on `main`
 * the sidebar's Host and Project filters.
 */
export function useSearchViewContext(catalog: SearchScopeCatalog | null): SearchViewContext | null {
  const published = usePublishedViewFilter();
  const serverIds = useSidebarViewStore((state) => state.hostFilters);
  const projectViewKeys = useSidebarViewStore((state) => state.projectFilters);
  return useMemo(() => {
    if (!catalog) return null;
    return resolveViewContext(published ?? { serverIds, projectViewKeys }, catalog);
  }, [catalog, projectViewKeys, published, serverIds]);
}

/** The chips "Only current filter" turns into. */
export function viewContextChips(
  view: SearchViewContext,
  catalog: SearchScopeCatalog,
): SearchScopeChip[] {
  const hosts: SearchScopeChip[] = [...(view.serverIds ?? [])].map((serverId) => ({
    kind: "host",
    serverId,
    label: catalog.hostById.get(serverId)?.label ?? serverId,
  }));
  const projects: SearchScopeChip[] = [...(view.projectKeys ?? [])].map((key) => ({
    kind: "project",
    key,
    label: catalog.projectByKey.get(key)?.label ?? key,
  }));
  return [...hosts, ...projects];
}
