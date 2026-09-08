import { useCallback, useMemo } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";
import { channelCatalogState, type ChannelCatalogState } from "../channel-catalog";
import { channelAccountHealthRows, channelCatalogRows } from "../channel-account-health";
import type { ChannelCatalogRow } from "../channel-account-health";
import {
  HubChannelCatalogSchema,
  HubChannelConfigurationSchema,
  HubChannelRuntimeStatusSchema,
  HubConnectionsSchema,
} from "../contracts";

export interface ChannelCatalogQueries {
  rows: ChannelCatalogRow[];
  catalog: ChannelCatalogState;
  refresh(): void;
  fetching: boolean;
  statusError: Error | null;
  configurationError: Error | null;
}

const CATALOG_RESOURCE = "channel-catalog";

/**
 * The Hub's catalog, on its own. Every channel surface reads it through this
 * hook and off one cache entry: the Hub answers the same catalog for every
 * organization, and it changes only when the Hub is upgraded, so it is held far
 * longer than the runtime reads it sits beside.
 */
export function useChannelCatalog(): ChannelCatalogState & { refresh(): void } {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const query = useFetchQuery({
    queryKey: hubResourceQueryKey(
      {
        origin: hub.origin,
        organizationId,
        accountId: hub.signedIn?.account.id ?? null,
      },
      CATALOG_RESOURCE,
    ),
    queryFn: () => hub.api().get(CATALOG_RESOURCE, HubChannelCatalogSchema),
    enabled: organizationId.length > 0,
    retry: false,
    dataShape: "value" as const,
    staleTimeMs: 300_000,
  });
  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);
  const state = useMemo(
    () => channelCatalogState({ entries: query.data?.channels, error: query.error }),
    [query.data?.channels, query.error],
  );
  return { ...state, refresh };
}

/**
 * The four reads the catalog screen joins. The three runtime keys are the ones
 * the Channels accounts view already uses, so the two surfaces share one cache
 * entry each rather than double-fetching.
 */
export function useChannelCatalogQueries(): ChannelCatalogQueries {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const scope = {
    origin: hub.origin,
    organizationId,
    accountId: hub.signedIn?.account.id ?? null,
  };
  const enabled = organizationId.length > 0;
  const catalog = useChannelCatalog();
  const channels = useFetchQuery({
    queryKey: hubResourceQueryKey(scope, "channel-configuration"),
    queryFn: () => hub.api().get("channel-configuration", HubChannelConfigurationSchema),
    enabled,
    retry: false,
    dataShape: "value" as const,
    staleTimeMs: 15_000,
  });
  const connections = useFetchQuery({
    queryKey: hubResourceQueryKey(scope, "connections"),
    queryFn: () => hub.api().get("connections", HubConnectionsSchema),
    enabled,
    retry: false,
    dataShape: "value" as const,
    staleTimeMs: 15_000,
  });
  const runtime = useFetchQuery({
    queryKey: [...hubResourceQueryKey(scope, "channel-accounts"), "status"],
    queryFn: () => hub.api().get("channel-accounts/status", HubChannelRuntimeStatusSchema),
    enabled,
    retry: false,
    dataShape: "value" as const,
    staleTimeMs: 15_000,
  });
  const rows = useMemo(
    () =>
      channelCatalogRows(
        channelAccountHealthRows({
          accounts: channels.data?.accounts,
          runtime: runtime.data?.accounts,
          connections: connections.data?.connections,
          catalog: catalog.entries,
        }),
        catalog.entries,
      ),
    [
      catalog.entries,
      channels.data?.accounts,
      connections.data?.connections,
      runtime.data?.accounts,
    ],
  );
  const catalogRefresh = catalog.refresh;
  const refresh = useCallback(() => {
    catalogRefresh();
    void channels.refetch();
    void connections.refetch();
    void runtime.refetch();
  }, [catalogRefresh, channels, connections, runtime]);
  return {
    rows,
    catalog,
    refresh,
    fetching: fetchingAny([channels, connections, runtime]),
    statusError: runtime.error,
    configurationError: channels.error,
  };
}

function fetchingAny(queries: readonly UseQueryResult<unknown, Error>[]): boolean {
  return queries.some((query) => query.isFetching);
}
