import { useMemo } from "react";
import type { OutsideFilterReveal } from "@/clisbot/search-scope/work-navigation";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import type { ListFilter } from "./outside-filter";
import { useNavigationStore, type ListSection } from "./store";

const NO_KEYS: readonly string[] = [];

/** The filter a list hides by: Work reads the sidebar's Host and Project filters, Chats its own. */
export function useListFilter(list: ListSection): ListFilter {
  const sidebarHosts = useSidebarViewStore((state) => state.hostFilters);
  const sidebarProjects = useSidebarViewStore((state) => state.projectFilters);
  const chatsHosts = useNavigationStore((state) => state.chatsHosts);
  const scope = useNavigationStore((state) => state.scopes[list]);
  return useMemo(
    () =>
      list === "work"
        ? { serverIds: sidebarHosts, projectViewKeys: sidebarProjects, scope }
        : { serverIds: chatsHosts, projectViewKeys: NO_KEYS, scope },
    [chatsHosts, list, scope, sidebarHosts, sidebarProjects],
  );
}

/** "Show all": clear only the dimension that hid the item; the rest of the filter stays. */
export function showAllFor(reveal: OutsideFilterReveal, list: ListSection): void {
  if (reveal.reason === "others") {
    useNavigationStore.getState().setScope(list, "all");
    return;
  }
  if (list === "chats") {
    useNavigationStore.getState().clearChatsHosts();
    return;
  }
  useSidebarViewStore.setState(
    reveal.reason === "host" ? { hostFilters: [] } : { projectFilters: [] },
  );
}

/** "Switch to {Host}" / "Switch to {project}": replace the hiding dimension with the item's. */
export function switchTo(reveal: OutsideFilterReveal, list: ListSection): void {
  if (reveal.reason === "others") return;
  if (list === "chats") {
    useNavigationStore.setState({ chatsHosts: [reveal.serverId] });
    return;
  }
  useSidebarViewStore.setState(
    reveal.reason === "host"
      ? { hostFilters: [reveal.serverId] }
      : { projectFilters: [...reveal.projectViewKeys] },
  );
}
