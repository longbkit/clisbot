import { useCallback, useMemo } from "react";
import { useHostsStrip } from "@/clisbot/home/hosts-strip-data";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

const ALL: readonly string[] = [];

/**
 * The app-wide Host filter (Owner, 2026-10-26): one choice for Home, Chats and Workspace, set from
 * the rail, a list's Display menu or Home's Host chip. It is the sidebar's saved Host filter, so
 * it survives restarts and drops a Host only once the Host list has settled.
 */
export function useHostFilter() {
  const serverIds = useHostFilterIds();
  const clear = useSidebarViewStore((state) => state.clearHostFilters);
  const toggle = useSidebarViewStore((state) => state.toggleHostFilter);
  const hosts = useAvailableHosts();
  const { summary } = useHostsStrip();
  const selected = useMemo(
    () => hosts.filter((host) => serverIds.includes(host.serverId)),
    [hosts, serverIds],
  );
  const clearFilter = useCallback(() => clear(), [clear]);
  return {
    serverIds,
    selected,
    active: serverIds.length > 0,
    clear: clearFilter,
    toggle,
    online: summary.online,
    total: summary.total,
  };
}

/** Only the filtered Host ids, for lists that apply the filter without showing Host status. */
export function useHostFilterIds(): readonly string[] {
  return useSidebarViewStore((state) => state.hostFilters) ?? ALL;
}
