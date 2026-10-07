import { useCallback, useMemo, useState } from "react";
import { useBotCatalog } from "../bots/data/runtime";
import { useConnectorAccounts, useConnectorCatalog, useConnectorSettings } from "./data";
import { useHostProjects } from "@/projects/host-projects";
import { connectorUses, matchesSearch, type ConnectorFilter, type ConnectorOwner } from "./model";
import { useProjectGrants } from "./project-grants";
import { buildLists, buildSections, findItem, parseSelection } from "./screen-model";

export { parseSelection, type ConnectorSelection } from "./screen-model";

/** How many list rows render before "Load more"; the list is not virtualized. */
const LIST_PAGE = 100;

/** Everything the Connectors screen shows for one Host, derived once. */
export function useConnectorsScreen(serverId: string) {
  const view = useListView();
  const settings = useConnectorSettings(serverId);
  const configured = settings.data?.composio.configured === true;
  const catalog = useConnectorCatalog(serverId, view.search);
  const accounts = useConnectorAccounts(serverId, configured);
  const accountMap = useMemo(
    () => new Map((accounts.data ?? []).map((app) => [app.slug, app] as const)),
    [accounts.data],
  );
  const servers = useMemo(
    () => (settings.data?.mcpServers ?? []).filter((server) => matchesSearch(server, view.search)),
    [settings.data, view.search],
  );
  const lists = useMemo(
    () => buildLists(catalog.items, accounts.data ?? [], accountMap, view.search),
    [catalog.items, accounts.data, accountMap, view.search],
  );
  const { filter, search, shown } = view;
  const sections = useMemo(
    () => buildSections({ filter, search, lists, servers, accountMap, shown }),
    [filter, search, lists, servers, accountMap, shown],
  );
  const selection = parseSelection(view.selectedKey);
  const uses = useSelectionUses(serverId, view.selectedKey);
  const visibleApps = filter === "all" ? lists.all.length : lists.connected.length;
  const { grow } = view;
  const loadMore = useCallback(() => {
    if (shown < visibleApps) grow();
    else catalog.loadMore();
  }, [catalog, grow, shown, visibleApps]);
  return {
    ...view,
    settings,
    catalog,
    accounts,
    configured,
    accountMap,
    lists,
    sections,
    uses,
    selection,
    selectedItem: selection?.kind === "app" ? findItem(lists.everything, selection.slug) : null,
    selectedServer:
      selection?.kind === "mcp"
        ? (settings.data?.mcpServers.find((server) => server.name === selection.name) ?? null)
        : null,
    counts: {
      all: catalog.loading ? 0 : (catalog.totalItems ?? catalog.items.length),
      connected: lists.connected.length,
      mcp: settings.data?.mcpServers.length ?? 0,
    },
    // Paging is about the whole catalog; the Connected and MCP lists are complete.
    footer:
      filter !== "all"
        ? undefined
        : {
            shown: Math.min(shown, visibleApps),
            total: search ? undefined : catalog.totalItems,
            hasMore: shown < visibleApps || catalog.hasMore,
            loadingMore: catalog.loadingMore,
            onLoadMore: loadMore,
          },
  };
}

/** Search, filter, selection and how many rows show; a new search or filter starts over. */
function useListView() {
  const [search, setSearchValue] = useState("");
  const [filter, setFilterValue] = useState<ConnectorFilter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [shown, setShown] = useState(LIST_PAGE);
  const setSearch = useCallback((value: string) => {
    setSearchValue(value);
    setShown(LIST_PAGE);
  }, []);
  const setFilter = useCallback((value: ConnectorFilter) => {
    setFilterValue(value);
    setShown(LIST_PAGE);
  }, []);
  const grow = useCallback(() => setShown((count) => count + LIST_PAGE), []);
  /** After a server is added: the MCP servers filter, with that server open. */
  const showServer = useCallback((name: string) => {
    setFilterValue("mcp");
    setSelectedKey(`mcp:${name}`);
  }, []);
  return {
    search,
    setSearch,
    filter,
    setFilter,
    selectedKey,
    setSelectedKey,
    showServer,
    shown,
    grow,
  };
}

/** The Bots and Projects on this Host granted the selected app or server. */
function useSelectionUses(serverId: string, selectedKey: string | null) {
  const { bots } = useBotCatalog();
  const projects = useHostProjects(useMemo(() => [serverId], [serverId]));
  const grants = useProjectGrants(serverId);
  const owners = useMemo(() => {
    const map = new Map<string, ConnectorOwner>();
    for (const project of projects) {
      for (const host of project.hosts) {
        if (host.serverId === serverId) map.set(host.projectId, { name: project.projectName });
      }
    }
    if (bots.loadState.status === "loaded") {
      for (const bot of bots.loadState.data) {
        if (bot.serverId === serverId) map.set(bot.projectId, { name: bot.name, botId: bot.id });
      }
    }
    return map;
  }, [bots.loadState, projects, serverId]);
  return useMemo(() => {
    const selection = parseSelection(selectedKey);
    if (selection === null || !grants.data) return [];
    const projectGrants = grants.data.grants;
    const target =
      selection.kind === "app" ? { app: selection.slug } : { mcpServer: selection.name };
    return connectorUses(projectGrants, owners, target);
  }, [grants.data, owners, selectedKey]);
}
