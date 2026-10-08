import type {
  ConnectorAppState,
  ConnectorCatalogItem,
  ConnectorMcpServer,
} from "@clisbot/protocol/connectors/types";
import { i18n } from "@/i18n/i18next";
import {
  appState,
  connectedOutsideCatalog,
  matchesSearch,
  orderCatalog,
  type AppConnectionState,
  type ConnectorFilter,
} from "./model";

/** The list's rows for the Connectors screen, from the catalog, accounts and servers. */

/** What one row of the list stands for; the screen turns its key into a selection. */
export interface ConnectorListRow {
  key: string;
  slug: string;
  name: string;
  logo?: string;
  state: AppConnectionState | "server" | "server-off";
}

function catalogRow(item: ConnectorCatalogItem, state: AppConnectionState): ConnectorListRow {
  return { key: `app:${item.slug}`, slug: item.slug, name: item.name, logo: item.logo, state };
}

function serverRow(server: ConnectorMcpServer): ConnectorListRow {
  return {
    key: `mcp:${server.name}`,
    slug: server.name,
    name: server.name,
    state: server.enabled === false ? "server-off" : "server",
  };
}

export type ConnectorSelection =
  | { kind: "app"; slug: string }
  | { kind: "mcp"; name: string }
  | null;

export function parseSelection(key: string | null): ConnectorSelection {
  if (!key) return null;
  if (key.startsWith("app:")) return { kind: "app", slug: key.slice(4) };
  if (key.startsWith("mcp:")) return { kind: "mcp", name: key.slice(4) };
  return null;
}

export function findItem(items: ConnectorCatalogItem[], slug: string): ConnectorCatalogItem {
  return items.find((item) => item.slug === slug) ?? { slug, name: slug };
}

export interface ConnectorLists {
  connected: ConnectorCatalogItem[];
  others: ConnectorCatalogItem[];
  all: ConnectorCatalogItem[];
  everything: ConnectorCatalogItem[];
}

export function buildLists(
  items: ConnectorCatalogItem[],
  accounts: ConnectorAppState[],
  map: ReadonlyMap<string, ConnectorAppState>,
  search: string,
): ConnectorLists {
  const outside = connectedOutsideCatalog(items, accounts).filter((item) =>
    matchesSearch(item, search),
  );
  const ordered = orderCatalog(items, map);
  const connected = [...ordered.connected, ...outside];
  return {
    connected,
    others: ordered.others,
    all: [...connected, ...ordered.others],
    everything: [...items, ...outside],
  };
}

export function buildSections(input: {
  filter: ConnectorFilter;
  search: string;
  lists: ConnectorLists;
  servers: ConnectorMcpServer[];
  accountMap: ReadonlyMap<string, ConnectorAppState>;
  shown: number;
}): { title: string; rows: ConnectorListRow[] }[] {
  const toRow = (item: ConnectorCatalogItem) =>
    catalogRow(item, appState(input.accountMap.get(item.slug)?.accounts));
  const { lists, shown } = input;
  const connected = i18n.t("connectors.screen.common.connected");
  if (input.filter === "mcp") {
    return input.servers.length
      ? [
          {
            title: i18n.t("connectors.screen.common.mcpServers"),
            rows: input.servers.map(serverRow),
          },
        ]
      : [];
  }
  if (input.filter === "connected") {
    return lists.connected.length
      ? [{ title: connected, rows: lists.connected.slice(0, shown).map(toRow) }]
      : [];
  }
  if (input.search.trim())
    return [
      {
        title: i18n.t("connectors.screen.list.results"),
        rows: lists.all.slice(0, shown).map(toRow),
      },
    ];
  const others = lists.others.slice(0, Math.max(0, shown - lists.connected.length));
  return [
    ...(lists.connected.length ? [{ title: connected, rows: lists.connected.map(toRow) }] : []),
    { title: i18n.t("connectors.screen.list.allApps"), rows: others.map(toRow) },
  ];
}
