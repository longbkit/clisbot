import { useCallback, useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import { useHosts } from "@/runtime/host-runtime";
import { useHubAccount } from "./account-provider";
import { HubDaemonsSchema } from "./contracts";
import { hubResourceQueryKey } from "./query-keys";

/** The Hub's daemon list for the signed-in account; one cached query shared by every reader. */
export function useHubDaemonsQuery() {
  const hub = useHubAccount();
  const signedIn = hub.signedIn;
  const organizationId = signedIn?.organization.id ?? null;
  return useFetchQuery({
    queryKey: hubResourceQueryKey(
      {
        origin: hub.origin,
        organizationId,
        accountId: signedIn?.account.id ?? null,
      },
      "daemons",
    ),
    queryFn: () => hub.api().get("daemons", HubDaemonsSchema),
    dataShape: "value",
    enabled: hub.enabled && organizationId !== null,
    retry: false,
    refetchInterval: 60_000,
    staleTimeMs: 0,
  });
}

/** The UI inventory combines user-saved Hosts with the current account's Hub Hosts.
 * Connection transport (direct or relay) never determines visibility. Keep the runtime's
 * registry intact: it also owns saved connections and asynchronous Hub reconciliation.
 */
export function useHostInventory() {
  const hub = useHubAccount();
  const registeredHosts = useHosts();
  const daemons = useHubDaemonsQuery();
  const organizationId = hub.signedIn?.organization.id ?? null;
  const hosts = useMemo(() => {
    if (!hub.enabled) return registeredHosts;
    return registeredHosts.filter((host) => {
      const management = host.management;
      if (management === undefined) return true;
      return (
        organizationId !== null &&
        management.hubOrigin === hub.origin &&
        management.organizationId === organizationId &&
        !daemons.isPlaceholderData &&
        daemons.data?.daemons.some(
          (daemon) =>
            daemon.id === management.daemonId && daemon.connectionOffer?.serverId === host.serverId,
        ) === true
      );
    });
  }, [
    registeredHosts,
    hub.enabled,
    hub.origin,
    organizationId,
    daemons.data,
    daemons.isPlaceholderData,
  ]);
  // An unresolved inventory must not trigger "no Hosts" navigation or automatically
  // select the sole local Host while authorized Hub Hosts are still arriving.
  const accountError = hub.enabled && hub.state === null ? hub.error : null;
  const error =
    accountError ?? (hub.enabled && organizationId !== null ? daemons.error?.message : null);
  let status: "error" | "loading" | "ready" = "ready";
  if (error) status = "error";
  else if (hub.enabled && (hub.loading || (organizationId !== null && daemons.data === undefined)))
    status = "loading";
  const refreshAccount = hub.refresh;
  const refetchDaemons = daemons.refetch;
  const retry = useCallback(() => {
    if (organizationId === null) void refreshAccount();
    else void refetchDaemons();
  }, [organizationId, refreshAccount, refetchDaemons]);
  return { hosts, daemons, status, error, retry };
}

export function useAvailableHosts() {
  return useHostInventory().hosts;
}
