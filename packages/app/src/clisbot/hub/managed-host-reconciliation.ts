import type { HubHostManagement } from "@/types/host-connection";

/**
 * Hub-managed Hosts for this account whose daemon is no longer projected as a
 * connectable Host — unenrolled, revoked, or replaced by a new enrollment under
 * a different daemon id.
 *
 * `HubHostSynchronization` unmounts a binding when its daemon leaves the Hub
 * list, and that unmount is what removes the Host. A Host persisted from an
 * earlier enrollment has no binding to unmount, so it would otherwise sit on
 * screen forever. This finds those leftovers for the caller to evict.
 *
 * Manual Hosts are never returned: the Hub binding adds ticket admission to a
 * user-owned Host without owning its lifecycle.
 */
export function orphanedManagedHosts(input: {
  hosts: readonly { management?: HubHostManagement }[];
  projectedDaemonIds: ReadonlySet<string>;
  hubOrigin: string;
  organizationId: string;
}): HubHostManagement[] {
  return input.hosts.flatMap((host) => {
    const management = host.management;
    if (
      management?.kind !== "hub" ||
      management.hubOrigin !== input.hubOrigin ||
      management.organizationId !== input.organizationId ||
      input.projectedDaemonIds.has(management.daemonId)
    ) {
      return [];
    }
    return [management];
  });
}
