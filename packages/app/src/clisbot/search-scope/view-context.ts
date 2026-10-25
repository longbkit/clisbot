import { useMemo } from "react";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import type { SearchViewContext } from "./candidates";
import type { SearchScopeCatalog } from "./catalog";
import { projectNameKey, type SearchScopeChip } from "./model";
import { usePublishedViewFilter, type PublishedViewFilter } from "./work-navigation";

function fromPublished(filter: PublishedViewFilter): SearchViewContext {
  return {
    label: filter.label,
    serverIds: filter.serverIds?.length ? new Set(filter.serverIds) : null,
    projectKeys: filter.projectNames?.length
      ? new Set(filter.projectNames.map(projectNameKey))
      : null,
  };
}

/** `main` has no Work pane: the sidebar's Host and Project filters are the list filter. */
function fromSidebar(
  hostFilters: readonly string[],
  projectFilters: readonly string[],
  catalog: SearchScopeCatalog,
): SearchViewContext | null {
  const serverIds = hostFilters.filter((id) => catalog.hostById.has(id));
  const projectKeys = [
    ...new Set(projectFilters.flatMap((key) => catalog.projectKeyByViewKey.get(key) ?? [])),
  ];
  if (serverIds.length === 0 && projectKeys.length === 0) return null;
  const label = [
    ...serverIds.map((id) => catalog.hostById.get(id)?.label ?? id),
    ...projectKeys.map((key) => catalog.projectByKey.get(key)?.label ?? key),
  ].join(" · ");
  return {
    label,
    serverIds: serverIds.length ? new Set(serverIds) : null,
    projectKeys: projectKeys.length ? new Set(projectKeys) : null,
  };
}

/** The list filter search ranks by (R1): what the opening section published, else the sidebar's. */
export function useSearchViewContext(catalog: SearchScopeCatalog | null): SearchViewContext | null {
  const published = usePublishedViewFilter();
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  return useMemo(() => {
    if (!catalog) return null;
    if (published) return fromPublished(published);
    return fromSidebar(hostFilters, projectFilters, catalog);
  }, [catalog, hostFilters, projectFilters, published]);
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
