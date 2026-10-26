import { useMemo } from "react";
import type { OutsideFilterReveal } from "@/clisbot/search-scope/work-navigation";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import type { ListFilter } from "./outside-filter";
import { useNavigationStore, type ListSection } from "./store";

const NO_KEYS: readonly string[] = [];

/**
 * The filter a list hides by: the app-wide Host filter (the sidebar's saved one), Workspace's
 * Project filter, and the list's scope.
 */
export function useListFilter(list: ListSection): ListFilter {
  const hosts = useSidebarViewStore((state) => state.hostFilters);
  const sidebarProjects = useSidebarViewStore((state) => state.projectFilters);
  const scope = useNavigationStore((state) => state.scopes[list]);
  return useMemo(
    () => ({
      serverIds: hosts,
      projectViewKeys: list === "work" ? sidebarProjects : NO_KEYS,
      scope,
    }),
    [hosts, list, scope, sidebarProjects],
  );
}

/** "Show all": clear only the dimension that hid the item; the rest of the filter stays. */
export function showAllFor(reveal: OutsideFilterReveal, list: ListSection): void {
  if (reveal.reason === "others") {
    useNavigationStore.getState().setScope(list, "all");
    return;
  }
  useSidebarViewStore.setState(
    reveal.reason === "host" || list === "chats" ? { hostFilters: [] } : { projectFilters: [] },
  );
}

/** "Switch to {Host}" / "Switch to {project}": replace the hiding dimension with the item's. */
export function switchTo(reveal: OutsideFilterReveal, list: ListSection): void {
  if (reveal.reason === "others") return;
  useSidebarViewStore.setState(
    reveal.reason === "host" || list === "chats"
      ? { hostFilters: [reveal.serverId] }
      : { projectFilters: [...reveal.projectViewKeys] },
  );
}
