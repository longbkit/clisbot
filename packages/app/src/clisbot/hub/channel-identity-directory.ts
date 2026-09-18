import { useCallback, useMemo } from "react";
import type { z } from "zod";
import { useFetchQuery } from "@/data/query";
import { useHubAccount } from "./account-provider";
import { hubResourceQueryKey } from "./query-keys";
import { channelCatalogLabel, type ChannelCatalogEntry } from "./channel-catalog";
// The catalog read is shared by every channel surface, so it does not belong
// under settings/. Moving it needs files another workstream is holding, so the
// import direction is inverted here until that lands.
import { useChannelCatalog } from "./settings/channel-catalog-queries";
import {
  HubChannelIdentitiesSchema,
  HubChannelIdentitySchema,
  HubConnectionSchema,
  HubConnectionsSchema,
} from "./contracts";

/** A Channel identity a Member has linked, joined to the Connection it belongs to. */
export interface LinkedChannelIdentity {
  id: string;
  memberId: string;
  connectionId: string;
  /** The Channel (chat platform) id, e.g. `slack`; absent when the Connection is gone. */
  channel: string | undefined;
  /** "Slack · acme-bot", or a plain notice when the Connection is unavailable. */
  label: string;
  /** The label with its workspace and realm id: "Slack · acme-bot · Acme · slack:T0456". */
  description: string;
  subject: string;
  verifiedAt: string;
}

export interface ChannelIdentityDirectory {
  /**
   * Hub scopes this list: a Member sees only their own links, an administrator
   * sees the organization's. An empty result therefore means "none visible to
   * you", not "this person has linked nothing".
   */
  identitiesOf(memberId: string | null | undefined): LinkedChannelIdentity[];
  pending: boolean;
  error: Error | null;
}

/**
 * The signed-in viewer's Channel identities and Connections, as Hub scopes them.
 * Every surface that shows or links identities reads through here so they share
 * one cache entry.
 */
export function useChannelIdentityReads(options?: {
  refetchIntervalMs?: number | false;
  /** Skip the reads entirely when the caller already knows it has nobody to look up. */
  enabled?: boolean;
}) {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const accountId = hub.signedIn?.account.id ?? null;
  const scope = { origin: hub.origin, organizationId, accountId };
  const enabled = organizationId.length > 0 && options?.enabled !== false;
  const identities = useFetchQuery({
    queryKey: [...hubResourceQueryKey(scope, "channel-identities"), "self"],
    queryFn: () => hub.api().get("channel-identities", HubChannelIdentitiesSchema),
    enabled,
    retry: false,
    refetchInterval: options?.refetchIntervalMs ?? false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  const connections = useFetchQuery({
    queryKey: [...hubResourceQueryKey(scope, "connections"), "self"],
    queryFn: () => hub.api().get("connections", HubConnectionsSchema),
    enabled,
    retry: false,
    dataShape: "value",
    staleTimeMs: 15_000,
  });
  return { identities, connections };
}

export function useChannelIdentityDirectory(options?: {
  refetchIntervalMs?: number;
  /** Skip the reads entirely when the caller already knows it has nobody to look up. */
  enabled?: boolean;
}): ChannelIdentityDirectory {
  const { identities, connections } = useChannelIdentityReads(options);
  const catalog = useChannelCatalog();
  const linked = useMemo(
    () =>
      linkedChannelIdentities(
        identities.data?.identities ?? [],
        connections.data?.connections ?? [],
        catalog.entries,
      ),
    [identities.data?.identities, connections.data?.connections, catalog.entries],
  );
  const identitiesOf = useCallback(
    (memberId: string | null | undefined) =>
      memberId ? linked.filter((identity) => identity.memberId === memberId) : [],
    [linked],
  );
  const pending = identities.isPending || connections.isPending;
  const error = identities.error ?? connections.error;
  // A stable result: a caller may hold this in a dependency array.
  return useMemo(() => ({ identitiesOf, pending, error }), [identitiesOf, pending, error]);
}

/** Joins each link to the Connections of its realm, and labels the Channel the way the Hub names it. */
export function linkedChannelIdentities(
  identities: readonly z.infer<typeof HubChannelIdentitySchema>[],
  connections: readonly z.infer<typeof HubConnectionSchema>[],
  catalog: readonly ChannelCatalogEntry[],
): LinkedChannelIdentity[] {
  return identities.map((identity) => {
    const realm = identityRealmConnections(identity, connections);
    return {
      id: identity.id,
      memberId: identity.memberId,
      connectionId: identity.connectionId,
      channel: realm[0]?.provider,
      label: identityRealmLabel(catalog, realm),
      description: channelIdentityLine(catalog, identity, connections),
      subject: identity.displayName ?? identity.externalSubjectId,
      verifiedAt: identity.verifiedAt,
    };
  });
}

/** The parts of a Connection its labels read. */
export type ChannelConnectionNaming = Pick<
  z.infer<typeof HubConnectionSchema>,
  "id" | "provider" | "name" | "externalName" | "consumers" | "identityRealm" | "identityRealmScope"
>;

/**
 * The Connections an identity resolves on: every one sharing its identity realm
 * (every bot of a Channel, one Slack workspace, or one bot). A Hub that reports
 * no realm scopes it to the one Connection it was verified through.
 */
export function identityRealmConnections<T extends ChannelConnectionNaming>(
  identity: LinkedIdentityScope,
  connections: readonly T[],
): T[] {
  return connections.filter((connection) => identityCoversConnection(identity, connection));
}

interface LinkedIdentityScope {
  connectionId: string;
  identityRealm?: string | undefined;
}

/** Whether messages through this Connection resolve to the identity. */
export function identityCoversConnection(
  identity: LinkedIdentityScope,
  connection: Pick<ChannelConnectionNaming, "id" | "identityRealm">,
): boolean {
  return identity.identityRealm === undefined
    ? connection.id === identity.connectionId
    : connection.identityRealm === identity.identityRealm;
}

/**
 * Names Connections by the Channel accounts that use them ("Slack · acme-bot,
 * support-bot"), because a Connection's own name is a generated slug nobody
 * recognises. A Connection no account uses yet keeps that slug.
 */
export function channelConnectionLabel(
  catalog: readonly ChannelCatalogEntry[],
  connections: readonly ChannelConnectionNaming[],
): string {
  const first = connections[0];
  if (first === undefined) return "Connection unavailable";
  return `${channelCatalogLabel(catalog, first.provider)} · ${channelBotNames(connections).join(", ")}`;
}

/**
 * The bots behind these Connections, named the way people find them: a Telegram
 * bot by its `@username` when the Hub knows it, otherwise the Channel accounts
 * using the Connection, or its slug when no account uses it yet.
 */
export function channelBotNames(connections: readonly ChannelConnectionNaming[]): string[] {
  return connections.flatMap((connection) => {
    if (connection.provider === "telegram" && isTelegramBotUsername(connection.externalName)) {
      return [`@${connection.externalName}`];
    }
    const accounts = connection.consumers
      .filter(({ resourceKind }) => resourceKind === "channel_account")
      .map(({ resourceId }) => resourceId.slice(resourceId.indexOf("/") + 1));
    return accounts.length > 0 ? accounts : [connection.name];
  });
}

// A Telegram bot username always ends in "bot"; the Hub's external name falls
// back to a display name or numeric id, which people cannot search for.
function isTelegramBotUsername(value: string | null): value is string {
  // Telegram usernames are 5-32 characters: a letter first, "bot" last.
  return value !== null && /^[a-z][a-z0-9_]{1,28}bot$/iu.test(value);
}

/**
 * The key of the realm a link through this Connection covers. A Hub that reports
 * no realm scopes the link to the Connection itself.
 */
export function connectionIdentityRealmKey(
  connection: Pick<ChannelConnectionNaming, "id" | "identityRealm">,
): string {
  return connection.identityRealm ?? `connection:${connection.id}`;
}

/** The provider workspace and the Connection id, e.g. "Acme · slack-a0123-t0456". */
export function channelConnectionDetail(connection: ChannelConnectionNaming): string {
  return connection.externalName === null
    ? connection.name
    : `${connection.externalName} · ${connection.name}`;
}

export type IdentityRealmScope = "channel" | "tenant" | "bot";

/** How far one link reaches; a realm the Hub does not scope links one bot at a time. */
export function identityRealmScopeOf(
  connections: readonly Pick<ChannelConnectionNaming, "identityRealmScope">[],
): IdentityRealmScope {
  const scope = connections[0]?.identityRealmScope;
  return scope === "channel" || scope === "tenant" ? scope : "bot";
}

/**
 * Names an identity realm the way people know it: "Telegram" for every bot of a
 * Channel, "Slack · VeXeRe" for a Slack workspace, "Feishu · support-bot" for
 * one bot. Never the realm id.
 */
export function identityRealmLabel(
  catalog: readonly ChannelCatalogEntry[],
  connections: readonly ChannelConnectionNaming[],
): string {
  const first = connections[0];
  if (first === undefined) return "Bot unavailable";
  const channel = channelCatalogLabel(catalog, first.provider);
  const scope = identityRealmScopeOf(connections);
  if (scope === "channel") return channel;
  if (scope === "bot") return `${channel} · ${channelBotNames([first]).join(", ")}`;
  const tenant = connections.find(({ externalName }) => externalName !== null)?.externalName;
  return `${channel} · ${tenant ?? first.name}`;
}

/** One line naming where an identity resolves: "Slack · VeXeRe · works with dai, oai". */
export function channelIdentityLine(
  catalog: readonly ChannelCatalogEntry[],
  identity: LinkedIdentityScope,
  connections: readonly ChannelConnectionNaming[],
): string {
  const realm = identityRealmConnections(identity, connections);
  if (realm.length === 0) return "No bot left to recognize this identity";
  const label = identityRealmLabel(catalog, realm);
  return identityRealmScopeOf(realm) === "bot"
    ? label
    : `${label} · works with ${channelBotNames(realm).join(", ")}`;
}
