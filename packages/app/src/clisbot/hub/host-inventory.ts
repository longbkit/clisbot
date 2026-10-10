import { useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { useFetchQueries, useFetchQuery } from "@/data/query";
import { useHosts } from "@/runtime/host-runtime";
import { type HubAccountContextValue, useHubAccount, useHubAccounts } from "./account-provider";
import { HubDaemonsSchema } from "./contracts";
import { hubResourceQueryKey } from "./query-keys";

type HubDaemons = z.infer<typeof HubDaemonsSchema>;

function hubDaemonsQueryKey(hub: HubAccountContextValue) {
  return hubResourceQueryKey(
    {
      origin: hub.origin,
      organizationId: hub.signedIn?.organization.id ?? null,
      accountId: hub.signedIn?.account.id ?? null,
    },
    "daemons",
  );
}

function hubDaemonsQueryInput(hub: HubAccountContextValue) {
  return {
    queryKey: hubDaemonsQueryKey(hub),
    queryFn: () => hub.api().get("daemons", HubDaemonsSchema),
    dataShape: "value" as const,
    enabled: hub.enabled && hub.signedIn !== null,
    retry: false,
    refetchInterval: 60_000,
    staleTimeMs: 0,
  };
}

/** The Hub's daemon list for the signed-in account; one cached query shared by every reader. */
export function useHubDaemonsQuery() {
  return useFetchQuery(hubDaemonsQueryInput(useHubAccount()));
}

type RegisteredHost = ReturnType<typeof useHosts>[number];

/** What one saved Hub's account lets this device see. */
export interface HubHostListing {
  origin: string | null;
  organizationId: string | null;
  daemons: { id: string; connectionOffer?: { serverId?: string } | null }[] | undefined;
}

/**
 * Whether a saved Host is visible to the Hub accounts on this device. A Hub-managed Host is
 * judged by the Hub that manages it, not by the selected Hub. With managed access off it is
 * reached with this device's own daemon credential, so it stays visible while that Hub is
 * unavailable. Every other managed Host needs its Hub to list it.
 */
export function isAccountHost(
  host: Pick<RegisteredHost, "serverId" | "management">,
  listings: readonly HubHostListing[],
): boolean {
  const management = host.management;
  if (management === undefined) return true;
  const listing = listings.find((entry) => entry.origin === management.hubOrigin);
  if (listing === undefined) return false;
  if (management.managedAccessMode === "off") return true;
  return (
    listing.organizationId !== null &&
    management.organizationId === listing.organizationId &&
    listing.daemons?.some(
      (daemon) =>
        daemon.id === management.daemonId && daemon.connectionOffer?.serverId === host.serverId,
    ) === true
  );
}

/** `useQueries` returns a new array every render; keep the previous one while its items match. */
function useStableItems<T>(items: readonly T[]): readonly T[] {
  const ref = useRef(items);
  if (ref.current.length !== items.length || ref.current.some((item, i) => item !== items[i]))
    ref.current = items;
  return ref.current;
}

/**
 * The UI inventory combines user-saved Hosts with the Hosts of every saved Hub account.
 * Connection transport (direct or relay) never determines visibility. Keep the runtime's
 * registry intact: it also owns saved connections and asynchronous Hub reconciliation.
 */
export function useHostInventory() {
  const queryClient = useQueryClient();
  const hub = useHubAccount();
  const accounts = useHubAccounts();
  const registeredHosts = useHosts();
  const queries = useFetchQueries(accounts.map(hubDaemonsQueryInput));
  const lists = useStableItems(queries.map((query) => query.data));
  const errors = useStableItems(queries.map((query) => query.error));
  const refetches = useStableItems(queries.map((query) => query.refetch));
  const hosts = useMemo(() => {
    if (accounts.length === 0) return registeredHosts;
    const listings = accounts.map((account, index) => ({
      origin: account.origin,
      organizationId: account.signedIn?.organization.id ?? null,
      daemons: lists[index]?.daemons,
    }));
    return registeredHosts.filter((host) => isAccountHost(host, listings));
  }, [accounts, lists, registeredHosts]);
  // Daemon ids are unique across Hubs, so one merged list answers "does a Hub list this Host".
  const daemons = useMemo<{ data: HubDaemons | undefined; error: Error | null }>(
    () => ({
      data: lists.some((list) => list !== undefined)
        ? { daemons: lists.flatMap((list) => list?.daemons ?? []) }
        : undefined,
      error: errors.find((error) => error !== null) ?? null,
    }),
    [errors, lists],
  );
  // Pending Hubs must not block usable Hosts. With no visible Host, keep waiting
  // rather than navigate to onboarding before the accounts finish resolving.
  const activeIndex = accounts.findIndex((account) => account.origin === hub.origin);
  const accountError = hub.enabled && hub.state === null ? hub.error : null;
  const error =
    accountError ??
    (hub.enabled && hub.signedIn !== null ? errors[activeIndex]?.message : null) ??
    null;
  let status: "error" | "loading" | "ready" = "ready";
  if (hosts.length > 0) status = "ready";
  else if (error) status = "error";
  else if (
    accounts.some(
      (account, index) =>
        account.loading ||
        (account.signedIn !== null && lists[index] === undefined && errors[index] === null),
    )
  )
    status = "loading";
  const retry = useCallback(() => {
    for (const [index, account] of accounts.entries()) {
      if (account.signedIn === null) void account.refresh();
      else {
        // A first fetch with no data may never settle. Explicit retry must replace it,
        // rather than join that pending request again; late results cannot restore access.
        void queryClient
          .cancelQueries({ queryKey: hubDaemonsQueryKey(account), exact: true })
          .then(() => refetches[index]?.());
      }
    }
  }, [accounts, queryClient, refetches]);
  return { hosts, daemons, status, error, retry };
}

export function useAvailableHosts() {
  return useHostInventory().hosts;
}
