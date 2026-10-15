import { useMemo } from "react";
import { useHosts, useHostRegistryLoaded } from "@/runtime/host-runtime";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

/** The list, its readiness line and empty body must describe the same effective Host scope. */
export function useSidebarHostIds(override?: readonly string[]): string[] {
  const hosts = useHosts();
  const loaded = useHostRegistryLoaded();
  const stored = useSidebarViewStore((state) => state.hostFilters);
  const filters = override ?? stored;
  return useMemo(() => {
    const all = hosts.map((host) => host.serverId);
    if (!filters.length) return all;
    const selected = all.filter((id) => filters.includes(id));
    return loaded && !selected.length ? all : selected;
  }, [hosts, loaded, filters]);
}
