import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConnectorAppState,
  ConnectorCatalogItem,
  ConnectorSettings,
  ConnectorTool,
} from "@clisbot/protocol/connectors/types";
import { useFetchQuery } from "@/data/query";
import { queryClient } from "@/data/query-client";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { hasPendingAccount } from "./model";

/**
 * Connector data for one Host, through the daemon client (docs/features/connectors/README.md).
 * Every reply carries `error`; a non-null one becomes a thrown Error the screen shows.
 */

/** How often accounts refresh while a sign-in is open in the browser. */
const PENDING_POLL_MS = 4000;

export class ConnectorsError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ConnectorsError";
  }
}

/** A refusal for lack of permission, from the daemon's gate or a Connectors handler. */
export function isAccessDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "access_denied"
  );
}

export function connectorsClient(serverId: string) {
  const client = getHostRuntimeStore().getClient(serverId);
  if (!client) throw new ConnectorsError("This Host is not connected.");
  return client;
}

export function unwrap<T extends { error: string | null; errorCode?: string }>(payload: T): T {
  if (payload.error) throw new ConnectorsError(payload.error, payload.errorCode);
  return payload;
}

export const connectorKeys = {
  all: (serverId: string) => ["connectors", serverId] as const,
  settings: (serverId: string) => ["connectors", serverId, "settings"] as const,
  catalog: (serverId: string, search: string) =>
    ["connectors", serverId, "catalog", search] as const,
  accounts: (serverId: string) => ["connectors", serverId, "accounts"] as const,
  tools: (serverId: string, target: string) => ["connectors", serverId, "tools", target] as const,
};

function refreshConnectors(serverId: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: connectorKeys.all(serverId) });
}

export function useConnectorSettings(serverId: string | null) {
  return useFetchQuery<ConnectorSettings>({
    queryKey: connectorKeys.settings(serverId ?? ""),
    enabled: serverId !== null,
    dataShape: "value",
    staleTimeMs: 30_000,
    queryFn: async () => {
      const payload = unwrap(await connectorsClient(serverId!).getConnectorSettings());
      if (!payload.settings) throw new ConnectorsError("The Host returned no Connector settings.");
      return payload.settings;
    },
  });
}

export interface CatalogResult {
  items: ConnectorCatalogItem[];
  totalItems?: number;
  hasMore: boolean;
  loadMore(): void;
  loadingMore: boolean;
  loading: boolean;
  error: Error | null;
}

type CatalogPage = Awaited<ReturnType<ReturnType<typeof connectorsClient>["listConnectorCatalog"]>>;

/**
 * The app catalog, a page of up to 1,000 at a time; a search asks the Host again. The first
 * page is a cached query; later pages are fetched on Load more and kept until the search changes.
 */
export function useConnectorCatalog(serverId: string | null, search: string): CatalogResult {
  const term = search.trim();
  const first = useFetchQuery<CatalogPage>({
    queryKey: connectorKeys.catalog(serverId ?? "", term),
    enabled: serverId !== null,
    dataShape: "value",
    staleTimeMs: 5 * 60_000,
    queryFn: async () =>
      unwrap(await connectorsClient(serverId!).listConnectorCatalog(term ? { search: term } : {})),
  });
  const more = useMorePages(serverId, term, first.data?.nextCursor ?? null);
  const items = useMemo(
    () => dedupe([...(first.data?.items ?? []), ...more.pages.flatMap((page) => page.items)]),
    [first.data, more.pages],
  );
  return {
    items,
    totalItems: first.data?.totalItems,
    hasMore: more.cursor !== null,
    loadMore: more.load,
    loadingMore: more.loading,
    loading: first.isLoading,
    error: first.error ?? more.error,
  };
}

/**
 * The cursor of the next page, or null at the end. Composio has answered a cursor with itself
 * or an earlier one; following it would load the same apps forever, so a repeat ends the list.
 */
function nextCursor(firstCursor: string | null, pages: readonly CatalogPage[]): string | null {
  const next = pages.length ? (pages[pages.length - 1]!.nextCursor ?? null) : firstCursor;
  if (next === null) return null;
  const used = [firstCursor, ...pages.slice(0, -1).map((page) => page.nextCursor)];
  return used.includes(next) ? null : next;
}

/** Pages after the first, for one search; a page that arrives after the search changed is dropped. */
function useMorePages(serverId: string | null, term: string, firstCursor: string | null) {
  const [pages, setPages] = useState<CatalogPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const search = `${serverId}\u0000${term}\u0000${firstCursor}`;
  const current = useRef(search);
  useEffect(() => {
    current.current = search;
    setPages([]);
    setLoading(false);
    setError(null);
  }, [search]);
  const cursor = nextCursor(firstCursor, pages);
  const load = useCallback(() => {
    if (serverId === null || cursor === null || loading) return;
    const asked = search;
    const stillAsked = () => current.current === asked;
    setLoading(true);
    setError(null);
    const fetchPage = async () => {
      try {
        const page = unwrap(
          await connectorsClient(serverId).listConnectorCatalog({
            ...(term ? { search: term } : {}),
            cursor,
          }),
        );
        if (stillAsked()) setPages((shown) => [...shown, page]);
      } catch (cause) {
        if (stillAsked()) setError(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        if (stillAsked()) setLoading(false);
      }
    };
    void fetchPage();
  }, [cursor, loading, search, serverId, term]);
  return { pages, cursor, load, loading, error };
}

function dedupe(items: ConnectorCatalogItem[]): ConnectorCatalogItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.slug)) return false;
    seen.add(item.slug);
    return true;
  });
}

/** Every connected account on the Host, polled while a sign-in is pending. */
export function useConnectorAccounts(serverId: string | null, enabled: boolean) {
  return useFetchQuery<ConnectorAppState[]>({
    queryKey: connectorKeys.accounts(serverId ?? ""),
    enabled: serverId !== null && enabled,
    dataShape: "list",
    staleTimeMs: 10_000,
    queryFn: async () => unwrap(await connectorsClient(serverId!).listConnectorAccounts()).apps,
    refetchInterval: (query) =>
      query.state.data && hasPendingAccount(query.state.data) ? PENDING_POLL_MS : false,
  });
}

function toolsTargetKey(target: { app: string } | { mcpServer: string } | null): string {
  if (target === null) return "";
  return "app" in target ? `app:${target.app}` : `mcp:${target.mcpServer}`;
}

export function useConnectorTools(
  serverId: string | null,
  target: { app: string } | { mcpServer: string } | null,
) {
  return useFetchQuery<ConnectorTool[]>({
    queryKey: connectorKeys.tools(serverId ?? "", toolsTargetKey(target)),
    enabled: serverId !== null && target !== null,
    dataShape: "list",
    staleTimeMs: 10 * 60_000,
    retry: false,
    queryFn: async () =>
      unwrap(await connectorsClient(serverId!).listConnectorTools({ ...target! })).tools,
  });
}

export async function saveComposioKey(serverId: string, apiKey: string | null): Promise<void> {
  unwrap(await connectorsClient(serverId).setComposioKey({ apiKey }));
  await refreshConnectors(serverId);
}

/** Starts a sign-in and returns the page to open in the browser. */
export async function startAccountConnect(
  serverId: string,
  slug: string,
  alias?: string,
): Promise<string> {
  const payload = unwrap(
    await connectorsClient(serverId).connectConnectorAccount({ slug, ...(alias ? { alias } : {}) }),
  );
  await queryClient.invalidateQueries({ queryKey: connectorKeys.accounts(serverId) });
  if (!payload.redirectUrl) throw new ConnectorsError("The Host returned no sign-in link.");
  return payload.redirectUrl;
}

export async function removeAccount(serverId: string, accountId: string): Promise<void> {
  unwrap(await connectorsClient(serverId).removeConnectorAccount({ accountId }));
  await queryClient.invalidateQueries({ queryKey: connectorKeys.accounts(serverId) });
}

export type McpServerSave = Parameters<
  ReturnType<typeof connectorsClient>["saveConnectorMcpServer"]
>[0];

export async function saveMcpServer(serverId: string, input: McpServerSave): Promise<void> {
  unwrap(await connectorsClient(serverId).saveConnectorMcpServer(input));
  await refreshConnectors(serverId);
}

export async function removeMcpServer(serverId: string, name: string): Promise<void> {
  unwrap(await connectorsClient(serverId).removeConnectorMcpServer({ name }));
  await refreshConnectors(serverId);
}
