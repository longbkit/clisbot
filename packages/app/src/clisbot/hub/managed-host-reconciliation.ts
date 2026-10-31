import type { HubHostManagement } from "@/types/host-connection";

/** What a Hub last answered for this device's account, as far as its Hosts are concerned. */
export type HubHostAnswer =
  /** No account is signed in (signed out, setup or password change required). */
  | { kind: "signedOut" }
  /** Signed in to `organizationId`, whose daemon list projects these connectable daemons. */
  | { kind: "listed"; organizationId: string; projectedDaemonIds: ReadonlySet<string> };

/**
 * The Hub-managed Hosts of `hubOrigin` that the Hub's answer no longer covers: every one once
 * the account is signed out; otherwise those under another organization and those whose daemon
 * is no longer projected as a connectable Host (unenrolled, revoked, or replaced by a new
 * enrollment under a different daemon id).
 *
 * This answer is the only thing that removes a Hub-managed Host. A binding unmounting is not:
 * the tree under the Hub scope can remount (a layout rebuilding, Android recreating the
 * activity's React surface) while the Hub's answer stays the same, and removing the Host then
 * wipes its directory (docs/features/offline/connection-resilience.md).
 *
 * Manual Hosts are never returned: the Hub binding adds ticket admission to a user-owned Host
 * without owning its lifecycle.
 */
export function orphanedManagedHosts(input: {
  hosts: readonly { management?: HubHostManagement }[];
  hubOrigin: string;
  answer: HubHostAnswer;
}): HubHostManagement[] {
  const { answer } = input;
  return input.hosts.flatMap((host) => {
    const management = host.management;
    if (management?.kind !== "hub" || management.hubOrigin !== input.hubOrigin) return [];
    if (
      answer.kind === "listed" &&
      management.organizationId === answer.organizationId &&
      answer.projectedDaemonIds.has(management.daemonId)
    ) {
      return [];
    }
    return [management];
  });
}
