import type { z } from "zod";
import { useCallback, useMemo } from "react";
import type { SelectFieldOption } from "@/components/ui/select-field";
import {
  channelBotNames,
  connectionIdentityRealmKey,
  identityCoversConnection,
  identityRealmLabel,
  identityRealmScopeOf,
  type IdentityRealmScope,
} from "../channel-identity-directory";
import { channelCatalogLabel, type ChannelCatalogEntry } from "../channel-catalog";
import type { HubChannelIdentitySchema, HubConnectionSchema } from "../contracts";

export type HubConnection = z.infer<typeof HubConnectionSchema>;
export type HubChannelIdentity = z.infer<typeof HubChannelIdentitySchema>;

/**
 * One identity realm the Member can link in: every bot of a Channel, one Slack
 * workspace, or one bot. One link covers every bot in it.
 */
export interface LinkRealm {
  key: string;
  provider: string;
  scope: IdentityRealmScope;
  /** The Channel's name, e.g. "Telegram". */
  channelLabel: string;
  label: string;
  /** Every bot a code of this realm redeems through. */
  botNames: string[];
  /** The Connections the Member may issue a code through. */
  connections: HubConnection[];
}

function groupByRealm(connections: readonly HubConnection[]): Map<string, HubConnection[]> {
  const byKey = new Map<string, HubConnection[]>();
  for (const connection of connections) {
    const key = connectionIdentityRealmKey(connection);
    byKey.set(key, [...(byKey.get(key) ?? []), connection]);
  }
  return byKey;
}

/** The realms the Member may issue a link code in, each named the way people know it. */
function linkRealms(
  realmConnections: readonly HubConnection[],
  catalog: readonly ChannelCatalogEntry[],
): LinkRealm[] {
  const everyBot = groupByRealm(realmConnections);
  const issuable = groupByRealm(realmConnections.filter(({ canLinkIdentity }) => canLinkIdentity));
  return Array.from(issuable, ([key, connections]) => {
    const members = everyBot.get(key) ?? connections;
    return {
      key,
      provider: connections[0].provider,
      scope: identityRealmScopeOf(members),
      channelLabel: channelCatalogLabel(catalog, connections[0].provider),
      label: identityRealmLabel(catalog, members),
      botNames: channelBotNames(members),
      connections,
    };
  });
}

/** One identity realm and the bots in it, named the way people know it. */
export interface IdentityRealm {
  key: string;
  label: string;
  connections: HubConnection[];
}

/** Every realm the organization's bots run in, whether or not a code can be issued there. */
export function identityRealms(
  connections: readonly HubConnection[],
  catalog: readonly ChannelCatalogEntry[],
): IdentityRealm[] {
  const realmConnections = connections.filter(
    ({ identityRealm }) => typeof identityRealm === "string",
  );
  return Array.from(groupByRealm(realmConnections), ([key, members]) => ({
    key,
    label: identityRealmLabel(catalog, members),
    connections: members,
  }));
}

function isCoveredByAny(
  identities: readonly HubChannelIdentity[],
  connection: HubConnection,
): boolean {
  return identities.some((identity) => identityCoversConnection(identity, connection));
}

/**
 * The realm the Member came from: the one holding the bot that sent them here,
 * found among every bot, so a bot they cannot issue through still selects its
 * realm when another bot of it can.
 */
function requestedRealmKey(
  connections: readonly HubConnection[],
  requestedConnectionId: string | null,
): string | undefined {
  const requested = connections.find(({ id }) => id === requestedConnectionId);
  return requested === undefined ? undefined : connectionIdentityRealmKey(requested);
}

/** The realm options for the link form, the chosen one, and whether a realm is already linked. */
export function useLinkRealms({
  connections,
  ownIdentities,
  identitiesLoaded,
  catalog,
  chosenRealmKey,
  requestedConnectionId,
}: {
  connections: readonly HubConnection[] | undefined;
  ownIdentities: readonly HubChannelIdentity[];
  identitiesLoaded: boolean;
  catalog: readonly ChannelCatalogEntry[];
  chosenRealmKey: string | null;
  requestedConnectionId: string | null;
}) {
  // Only Channel Connections carry a realm; provider Connections (GitHub, Linear) never do.
  const realmConnections = useMemo(
    () => (connections ?? []).filter(({ identityRealm }) => typeof identityRealm === "string"),
    [connections],
  );
  // The catalog arrives after the Connections do; it is a dependency so the
  // labels do not keep the fallback name for the rest of the session.
  const realms = useMemo(() => linkRealms(realmConnections, catalog), [realmConnections, catalog]);
  const linkedKeys = useMemo(
    () =>
      new Set(
        realmConnections
          .filter((connection) => isCoveredByAny(ownIdentities, connection))
          .map(connectionIdentityRealmKey),
      ),
    [realmConnections, ownIdentities],
  );
  const isLinked = useCallback((key: string) => linkedKeys.has(key), [linkedKeys]);
  const unlinked = useMemo(() => realms.filter(({ key }) => !isLinked(key)), [realms, isLinked]);
  const options = useMemo(() => unlinked.map(realmOption), [unlinked]);
  const requestedKey = requestedRealmKey(realmConnections, requestedConnectionId);
  const requested = realms.find(({ key }) => key === requestedKey);
  // With one place left to link, there is nothing to choose.
  const preselected =
    chosenRealmKey ?? requested?.key ?? (unlinked.length === 1 ? unlinked[0].key : null);
  return {
    options,
    selected: unlinked.find(({ key }) => key === preselected),
    isLinked,
    requestedReady: connections !== undefined && identitiesLoaded,
    requestedLinked: requestedKey !== undefined && isLinked(requestedKey),
    allLinked: realms.length > 0 && unlinked.length === 0,
    emptyText:
      realms.length > 0
        ? "You are linked everywhere this organization's bots run."
        : "This organization has no chat bots yet.",
  };
}

function realmOption(realm: LinkRealm): SelectFieldOption<string> {
  return {
    id: realm.key,
    value: realm.key,
    label: realm.label,
    description:
      realm.scope === "bot"
        ? "Links this bot only"
        : `One link covers every bot here: ${realm.botNames.join(", ")}`,
  };
}
