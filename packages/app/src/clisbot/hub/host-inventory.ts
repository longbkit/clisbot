import { useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { useFetchQueries, useFetchQuery } from "@/data/query";
import { useHosts, useHostRuntimeConnectedServerIds } from "@/runtime/host-runtime";
import { type HubAccountContextValue, useHubAccount, useHubAccounts } from "./account-provider";
import { classifyHubFailure } from "./hub-failure";
import { HubDaemonsSchema } from "./contracts";
import {
  cachedListForAccount,
  getHubDaemonListCache,
  useHubDaemonListCache,
} from "./hub-daemon-list-cache";
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

const HUB_LIST_POLL_MS = 60_000;
const HUB_LIST_MAX_POLL_MS = 300_000;
/** Consecutive failed list reads per query; the query cache resets its own count per fetch. */
const listFailures = new Map<string, number>();

/** 60 s while the Hub answers; after failures, a jittered doubling up to 5 min. */
export function hubListPollIntervalMs(failures: number, random: () => number = Math.random) {
  if (failures <= 0) return HUB_LIST_POLL_MS;
  const ceiling = Math.min(HUB_LIST_MAX_POLL_MS, HUB_LIST_POLL_MS * 2 ** (failures - 1));
  return Math.round(ceiling * (0.5 + random() / 2));
}

/**
 * Reads the list and keeps the remembered copy in step: replaced on success, dropped on 403. A
 * read the query cancelled (`signal` aborted) still runs to its end but is not counted as a
 * failure: one refused list must not count once per caller that replaced it.
 */
export async function readHubDaemons(
  hub: HubAccountContextValue,
  signal?: AbortSignal,
): Promise<HubDaemons> {
  const failureKey = JSON.stringify(hubDaemonsQueryKey(hub));
  const cache = getHubDaemonListCache();
  try {
    const list = await hub.api().get("daemons", HubDaemonsSchema);
    listFailures.delete(failureKey);
    if (hub.origin !== null && hub.signedIn !== null)
      cache.remember({
        origin: hub.origin,
        accountId: hub.signedIn.account.id,
        organizationId: hub.signedIn.organization.id,
        daemons: list.daemons,
        syncedAt: new Date().toISOString(),
      });
    return list;
  } catch (error) {
    if (signal?.aborted !== true)
      listFailures.set(failureKey, (listFailures.get(failureKey) ?? 0) + 1);
    if (hub.origin !== null && classifyHubFailure(error) === "revoked") cache.forget(hub.origin);
    throw error;
  }
}

function hubDaemonsQueryInput(hub: HubAccountContextValue) {
  const failureKey = JSON.stringify(hubDaemonsQueryKey(hub));
  return {
    queryKey: hubDaemonsQueryKey(hub),
    queryFn: ({ signal }: { signal: AbortSignal }) => readHubDaemons(hub, signal),
    dataShape: "value" as const,
    enabled: hub.enabled && hub.signedIn !== null,
    retry: false,
    refetchInterval: () => hubListPollIntervalMs(listFailures.get(failureKey) ?? 0),
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
 * unavailable. A Desktop session authenticated locally is also independent of Hub inventory.
 * Every other managed Host needs its Hub to list it.
 */
export function isAccountHost(
  host: Pick<RegisteredHost, "serverId" | "management">,
  listings: readonly HubHostListing[],
  locallyConnected = false,
): boolean {
  if (locallyConnected) return true;
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
  const serverIds = useMemo(() => registeredHosts.map((host) => host.serverId), [registeredHosts]);
  const localServerIds = useHostRuntimeConnectedServerIds(serverIds, true);
  const queries = useFetchQueries(accounts.map(hubDaemonsQueryInput));
  const lists = useStableItems(queries.map((query) => query.data));
  const errors = useStableItems(queries.map((query) => query.error));
  const refetches = useStableItems(queries.map((query) => query.refetch));
  const listCache = useHubDaemonListCache();
  // A Hub without a live list falls back to the list it last returned for this account, so
  // its Hosts stay visible while it (or its VPN) is unreachable. Fresh lists always win.
  const remembered = useStableItems(
    accounts.map((account, index) =>
      lists[index] === undefined && account.origin !== null
        ? cachedListForAccount(listCache.get(account.origin), account)
        : undefined,
    ),
  );
  const hosts = useMemo(() => {
    if (accounts.length === 0) return registeredHosts;
    const listings = accounts.map((account, index) => ({
      origin: account.origin,
      organizationId:
        account.signedIn?.organization.id ?? remembered[index]?.organizationId ?? null,
      daemons: lists[index]?.daemons ?? remembered[index]?.daemons,
    }));
    return registeredHosts.filter((host) =>
      isAccountHost(host, listings, localServerIds.includes(host.serverId)),
    );
  }, [accounts, lists, remembered, registeredHosts, localServerIds]);
  /** Hubs whose Hosts are shown from a remembered list, with the time it was read. */
  const lastSyncedAtByOrigin = useMemo(() => {
    const result = new Map<string, string>();
    for (const [index, account] of accounts.entries()) {
      const list = remembered[index];
      if (account.origin !== null && list !== undefined) result.set(account.origin, list.syncedAt);
    }
    return result;
  }, [accounts, remembered]);
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
  // Every Hub account has answered, or failed: its Host list will not grow on its own.
  const settled = !accounts.some(
    (account, index) =>
      account.loading ||
      (account.signedIn !== null && lists[index] === undefined && errors[index] === null),
  );
  let status: "error" | "loading" | "ready" = "ready";
  if (hosts.length > 0) status = "ready";
  else if (error) status = "error";
  else if (!settled) status = "loading";
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
  return { hosts, daemons, status, settled, error, retry, lastSyncedAtByOrigin };
}

export function useAvailableHosts() {
  return useHostInventory().hosts;
}
