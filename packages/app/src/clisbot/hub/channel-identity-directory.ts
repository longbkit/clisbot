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

export function useChannelIdentityDirectory(options?: {
  refetchIntervalMs?: number;
  /** Skip the reads entirely when the caller already knows it has nobody to look up. */
  enabled?: boolean;
}): ChannelIdentityDirectory {
  const hub = useHubAccount();
  const organizationId = hub.signedIn?.organization.id ?? "";
  const accountId = hub.signedIn?.account.id ?? null;
  const scope = { origin: hub.origin, organizationId, accountId };
  const enabled = organizationId.length > 0 && options?.enabled !== false;
  const refetchInterval = options?.refetchIntervalMs ?? false;
  const identities = useFetchQuery({
    queryKey: [...hubResourceQueryKey(scope, "channel-identities"), "self"],
    queryFn: () => hub.api().get("channel-identities", HubChannelIdentitiesSchema),
    enabled,
    retry: false,
    refetchInterval,
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
      label: channelConnectionLabel(catalog, realm),
      subject: identity.displayName ?? identity.externalSubjectId,
      verifiedAt: identity.verifiedAt,
    };
  });
}

/** The parts of a Connection its labels read. */
export type ChannelConnectionNaming = Pick<
  z.infer<typeof HubConnectionSchema>,
  "id" | "provider" | "name" | "externalName" | "consumers" | "identityRealm"
>;

/**
 * The Connections an identity resolves on: every one sharing its realm (a Slack
 * workspace, or Telegram). A Hub that reports no realm scopes it to the one
 * Connection it was verified through.
 */
export function identityRealmConnections<T extends ChannelConnectionNaming>(
  identity: { connectionId: string; identityRealm?: string | undefined },
  connections: readonly T[],
): T[] {
  const realm = identity.identityRealm;
  return realm === undefined
    ? connections.filter(({ id }) => id === identity.connectionId)
    : connections.filter(({ identityRealm }) => identityRealm === realm);
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
  const names = connections.flatMap((connection) => {
    const accounts = connection.consumers
      .filter(({ resourceKind }) => resourceKind === "channel_account")
      .map(({ resourceId }) => resourceId.slice(resourceId.indexOf("/") + 1));
    return accounts.length > 0 ? accounts : [connection.name];
  });
  return `${channelCatalogLabel(catalog, first.provider)} · ${names.join(", ")}`;
}

/** The provider workspace and the Connection id, e.g. "Acme · slack-a0123-t0456". */
export function channelConnectionDetail(connection: ChannelConnectionNaming): string {
  return connection.externalName === null
    ? connection.name
    : `${connection.externalName} · ${connection.name}`;
}

/**
 * The provider workspace and the realm id of an identity, e.g. "Acme · slack:T0456";
 * the Connection id stands in when the Hub reports no realm.
 */
export function channelIdentityRealmDetail(
  identity: { connectionId: string; identityRealm?: string | undefined },
  connections: readonly ChannelConnectionNaming[],
): string {
  const workspace = connections.find(
    (connection) => connection.externalName !== null,
  )?.externalName;
  const realmId =
    identity.identityRealm ??
    connections.find((connection) => connection.id === identity.connectionId)?.name ??
    identity.connectionId;
  return workspace === undefined || workspace === null ? realmId : `${workspace} · ${realmId}`;
}
