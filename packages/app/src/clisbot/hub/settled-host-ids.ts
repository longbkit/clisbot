import { useEffect, useMemo } from "react";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useHostRegistryLoaded, useHosts } from "@/runtime/host-runtime";
import { useHostInventory } from "./host-inventory";

interface ListedDaemon {
  connectionOffer?: { serverId?: string | null } | null;
}

/**
 * The Host ids a saved Host filter may still name, or null while that cannot be judged. Until the
 * registry has loaded and every signed-in Hub has answered, an unknown Host is pending, not gone:
 * a Hub's Hosts join the registry asynchronously after its list arrives, so a Host the Hub lists
 * but the registry has not added yet still counts.
 */
export function settledHostIds(input: {
  registryLoaded: boolean;
  hubsSettled: boolean;
  registered: readonly string[];
  listed: readonly ListedDaemon[];
}): ReadonlySet<string> | null {
  if (!input.registryLoaded || !input.hubsSettled) return null;
  const ids = new Set(input.registered);
  for (const daemon of input.listed) {
    const serverId = daemon.connectionOffer?.serverId;
    if (serverId) ids.add(serverId);
  }
  return ids;
}

export function useSettledHostIds(): ReadonlySet<string> | null {
  const registryLoaded = useHostRegistryLoaded();
  const hosts = useHosts();
  const { settled, daemons } = useHostInventory();
  return useMemo(
    () =>
      settledHostIds({
        registryLoaded,
        hubsSettled: settled,
        registered: hosts.map((host) => host.serverId),
        listed: daemons.data?.daemons ?? [],
      }),
    [daemons.data, hosts, registryLoaded, settled],
  );
}

/**
 * Drops Hosts that are gone from the saved Host filter, once, app-wide. Mounted inside the Hub
 * scope so it can tell a Hub Host still arriving from one that was removed.
 */
export function HostFilterReconciler(): null {
  const ids = useSettledHostIds();
  const reconcile = useSidebarViewStore((state) => state.reconcileHostFilters);
  useEffect(() => {
    if (ids) reconcile([...ids]);
  }, [ids, reconcile]);
  return null;
}
