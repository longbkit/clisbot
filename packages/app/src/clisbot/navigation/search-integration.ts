import { useEffect } from "react";
import { useRouter, type Href } from "expo-router";
import { useRoutePathEffect } from "@/navigation/route-source";
import {
  dismissOutsideFilterReveal,
  getOutsideFilterReveal,
  replaceSidebarFilters,
  revealEndsOnPath,
  setOpenInWorkHandler,
  setSearchViewContext,
  type OpenInWorkHandler,
} from "@/clisbot/search-scope/work-navigation";
import { usePanelStore } from "@/stores/panel-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { WORK_PATH } from "./sections";
import { useNavigationStore } from "./store";
import { useActiveSection } from "./use-open-section";

/**
 * Work's filter is what global search ranks by (R1): its Host and Project filters (the sidebar's,
 * which Work reads) and its For me / Others scope. Search offers "Only current filter" only when
 * it was opened from Work.
 */
function usePublishWorkFilter(): void {
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const scope = useNavigationStore((state) => state.scopes.work);
  const fromWork = useActiveSection() === "work";
  useEffect(() => {
    setSearchViewContext({
      serverIds: hostFilters,
      projectViewKeys: projectFilters,
      ownership: scope,
      suggest: fromWork,
    });
  }, [fromWork, hostFilters, projectFilters, scope]);
  useEffect(() => () => setSearchViewContext(null), []);
}

/** R4 in Navigation V2: replace Work's filter, open the Work section; Undo restores the filter. */
function useWorkOpenInWork(): void {
  const router = useRouter();
  useEffect(() => {
    const handler: OpenInWorkHandler = (target, layout) => {
      const restore = replaceSidebarFilters(target);
      useNavigationStore.getState().setLastList("work");
      router.navigate(WORK_PATH as Href);
      usePanelStore.getState().openAgentListForLayout(layout);
      return restore;
    };
    return setOpenInWorkHandler(handler);
  }, [router]);
}

/** Opening another item ends the reveal (R3): the notice is about the item search opened. */
function useEndRevealOnNavigation(): void {
  useRoutePathEffect((pathname) => {
    const reveal = getOutsideFilterReveal();
    if (reveal && revealEndsOnPath(reveal, pathname)) dismissOutsideFilterReveal();
  });
}

/** Wires global search to Navigation V2's Work list; mounted with the V2 chrome. */
export function useNavigationSearchIntegration(): void {
  usePublishWorkFilter();
  useWorkOpenInWork();
  useEndRevealOnNavigation();
}
