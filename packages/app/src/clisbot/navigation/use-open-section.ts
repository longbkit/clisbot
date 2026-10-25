import { useCallback } from "react";
import { usePathname, useRouter, type Href } from "expo-router";
import { buildSettingsRoute } from "@/utils/host-routes";
import { usePanelStore } from "@/stores/panel-store";
import { useNavigationStore, type ListSection } from "./store";
import {
  CHATS_PATH,
  WORK_PATH,
  sectionForPath,
  type BuiltinSection,
  type BuiltinSectionId,
} from "./sections";

const LIST_PATHS: Record<ListSection, string> = { chats: CHATS_PATH, work: WORK_PATH };

/** The section the reader is in, with session details counted under the list they came from. */
export function useActiveSection(): ReturnType<typeof sectionForPath> {
  const pathname = usePathname();
  const lastList = useNavigationStore((state) => state.lastList);
  return sectionForPath(pathname, lastList);
}

/**
 * Opens a section from the desktop rail. Chats and Work own the list pane: opening the one already
 * showing hides or shows its pane (as ⌘B does); opening the other switches the pane and, unless a
 * session of that list is open, shows the list's own page.
 */
export function useOpenRailSection() {
  const router = useRouter();
  const pathname = usePathname();
  const active = useActiveSection();
  return useCallback(
    (section: BuiltinSection) => {
      const id: BuiltinSectionId = section.id;
      if (id === "chats" || id === "work") {
        const panels = usePanelStore.getState();
        const store = useNavigationStore.getState();
        if (active === id) {
          if (pathname === LIST_PATHS[id]) panels.openDesktopAgentList();
          else panels.toggleDesktopAgentList();
          return;
        }
        store.setLastList(id);
        panels.openDesktopAgentList();
        const detailOfList = sectionForPath(pathname, id) === id && pathname.startsWith("/h/");
        if (!detailOfList || id === "chats") router.navigate(LIST_PATHS[id] as Href);
        return;
      }
      if (id === "settings") {
        router.push(buildSettingsRoute());
        return;
      }
      if (section.href) router.navigate(section.href as Href);
    },
    [active, pathname, router],
  );
}
