import { useMemo } from "react";
import type { ConnectorAccount } from "@clisbot/protocol/connectors/types";
import type { ConnectorChoice } from "./add-connector-sheet";
import { useConnectorAccounts, useConnectorCatalog, useConnectorSettings } from "./data";
import { appState } from "./model";
import { connectorAppTitle } from "@clisbot/protocol/connectors/types";

export interface ConnectorLookup {
  choices: ConnectorChoice[];
  name(slug: string): string;
  logo(slug: string): string | undefined;
  /** The app's working accounts on this Host. */
  accounts(slug: string): ConnectorAccount[];
  /** False only once the Host's accounts are known and none works for this app. */
  connected(slug: string): boolean;
  /** True for an app that runs without signing in (Hacker News): it has no accounts. */
  noAuth(slug: string): boolean;
}

/** Names, logos and connection state for the apps and servers on one Host. */
export function useConnectorLookup(serverId: string): ConnectorLookup {
  const settings = useConnectorSettings(serverId);
  const accounts = useConnectorAccounts(serverId, settings.data?.composio.configured === true);
  const catalog = useConnectorCatalog(serverId, "");
  return useMemo(() => {
    const items = new Map(catalog.items.map((item) => [item.slug, item] as const));
    const working = new Set(
      (accounts.data ?? [])
        .filter((app) => appState(app.accounts) === "connected")
        .map((app) => app.slug),
    );
    const name = (slug: string) => items.get(slug)?.name ?? connectorAppTitle(slug);
    const choices: ConnectorChoice[] = [];
    for (const slug of working) {
      choices.push({ kind: "app", slug, name: name(slug), logo: items.get(slug)?.logo });
    }
    for (const server of settings.data?.mcpServers ?? []) {
      choices.push({ kind: "mcp", name: server.name });
    }
    return {
      choices,
      name,
      logo: (slug) => items.get(slug)?.logo,
      accounts: (slug) =>
        (accounts.data ?? [])
          .find((app) => app.slug === slug)
          ?.accounts.filter((account) => account.status === "ACTIVE") ?? [],
      connected: (slug) =>
        accounts.data === undefined || working.has(slug) || items.get(slug)?.noAuth === true,
      noAuth: (slug) => items.get(slug)?.noAuth === true,
    };
  }, [accounts.data, catalog.items, settings.data]);
}
