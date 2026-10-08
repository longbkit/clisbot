import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
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

type RegisteredHost = ReturnType<typeof useHosts>[number];

/**
 * Whether the current Hub account may see a saved Host. A Host with managed access off that
 * belongs to the selected Hub is reached with this device's own daemon credential, so it stays
 * visible while that Hub is unavailable. Every other managed Host needs the Hub to list it.
 */
export function isAccountHost(
  host: Pick<RegisteredHost, "serverId" | "management">,
  account: {
    origin: string | null;
    organizationId: string | null;
    daemons: { id: string; connectionOffer?: { serverId?: string } | null }[] | undefined;
  },
): boolean {
  const management = host.management;
  if (management === undefined) return true;
  if (management.managedAccessMode === "off" && management.hubOrigin === account.origin)
    return true;
  return (
    account.organizationId !== null &&
    management.hubOrigin === account.origin &&
    management.organizationId === account.organizationId &&
    account.daemons?.some(
      (daemon) =>
        daemon.id === management.daemonId && daemon.connectionOffer?.serverId === host.serverId,
    ) === true
  );
}

/** The UI inventory combines user-saved Hosts with the current account's Hub Hosts.
 * Connection transport (direct or relay) never determines visibility. Keep the runtime's
 * registry intact: it also owns saved connections and asynchronous Hub reconciliation.
 */
export function useHostInventory() {
  const queryClient = useQueryClient();
  const hub = useHubAccount();
  const registeredHosts = useHosts();
  const daemons = useHubDaemonsQuery();
  const organizationId = hub.signedIn?.organization.id ?? null;
  const hosts = useMemo(() => {
    if (!hub.enabled) return registeredHosts;
    const listed = daemons.isPlaceholderData ? undefined : daemons.data?.daemons;
    return registeredHosts.filter((host) =>
      isAccountHost(host, { origin: hub.origin, organizationId, daemons: listed }),
    );
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
  const accountId = hub.signedIn?.account.id ?? null;
  const origin = hub.origin;
  const retry = useCallback(() => {
    if (organizationId === null) void refreshAccount();
    else {
      // A first fetch with no data may never settle. Explicit retry must replace it,
      // rather than join that pending request again; late results cannot restore access.
      void queryClient
        .cancelQueries({
          queryKey: hubResourceQueryKey({ origin, organizationId, accountId }, "daemons"),
          exact: true,
        })
        .then(() => refetchDaemons());
    }
  }, [queryClient, origin, accountId, organizationId, refreshAccount, refetchDaemons]);
  return { hosts, daemons, status, error, retry };
}

export function useAvailableHosts() {
  return useHostInventory().hosts;
}
