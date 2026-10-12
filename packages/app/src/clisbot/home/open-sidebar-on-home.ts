import { useEffect, useRef } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import { selectHasWorkspaces } from "@/stores/session-store-hooks/selectors";
import { HOME_V2_ENABLED } from "./feature";

/**
 * Home is where nothing is selected yet, so show the sidebar next to it. Desktop always opens it.
 * A phone opens it once per visit, and only when a Host already has a project (every bot has
 * one): someone who just paired a phone does not know to swipe for the bots and projects that
 * already exist. With nothing to list, the phone stays on the two ways to start.
 *
 * Home V2 gives the phone a Chat tab that is the sidebar, and Home itself is where a chat starts,
 * so there the phone never opens it on its own: it would cover the composer and stay open over
 * the next tab.
 */
export function useOpenSidebarOnHome(hosts: { serverId: string }[]) {
  const isCompact = useIsCompactFormFactor();
  const openDesktopAgentList = usePanelStore((s) => s.openDesktopAgentList);
  const showMobileAgentList = usePanelStore((s) => s.showMobileAgentList);
  const hasProjects = useSessionStore((state) =>
    hosts.some((host) => selectHasWorkspaces(state, host.serverId)),
  );
  const openedOnPhone = useRef(false);
  useEffect(() => {
    if (!isCompact) {
      openDesktopAgentList();
      return;
    }
    if (HOME_V2_ENABLED || !hasProjects || openedOnPhone.current) return;
    openedOnPhone.current = true;
    showMobileAgentList();
  }, [isCompact, hasProjects, openDesktopAgentList, showMobileAgentList]);
}
