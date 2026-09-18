import { and, eq, notInArray } from "drizzle-orm";
import * as schema from "../db/schema.js";
import type { DrizzleHandle } from "../db/runtime/index.js";
import {
  CHANNEL_CONNECTION_TABLE_ENTRIES,
  CHANNEL_CONNECTION_TABLES,
} from "../db/channel-connections.js";
import type { ChannelConnectionChannel } from "../db/types.js";

/**
 * The set of Connections across which one provider sender id names one person,
 * so a Channel identity is verified once per realm rather than once per bot.
 * Encoded as a string:
 *
 * - `<channel>` — every bot of the Channel sees the same user id.
 * - `slack:<team id>` — one Slack workspace. Every app installed in it sees the
 *   same user id; ids from unrelated workspaces prove nothing about each other.
 * - `<channel>:bot:<connection id>` — the id is per bot (or not verified to be
 *   wider), so the realm is that one Connection.
 */
export type ChannelIdentityRealm = string;

/** How far one sender id reaches: every bot of the Channel, one provider tenant, or one bot. */
export type ChannelIdentityRealmScope = "channel" | "tenant" | "bot";

export type IdentityChannel = "slack" | ChannelConnectionChannel;

/**
 * Where each Channel's sender id is stable. Grouping too widely lets one person's
 * id resolve to another Member, so a Channel is `bot`-scoped until its id is
 * shown to be wider.
 *
 * - telegram: a user id is the same for every bot.
 * - discord: a user snowflake is global.
 * - googlechat: `users/{id}` is the person's People API id for every app.
 * - slack: a user id is per workspace (`tenant`).
 * - feishu: `open_id` is per app.
 * - zalo: an Official Account sees an OA-scoped user id.
 * - zalouser: not verified to be global across personal accounts.
 */
export const CHANNEL_IDENTITY_REALM_SCOPE: Record<IdentityChannel, ChannelIdentityRealmScope> = {
  telegram: "channel",
  discord: "channel",
  googlechat: "channel",
  slack: "tenant",
  feishu: "bot",
  zalo: "bot",
  zalouser: "bot",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SLACK_REALM_PREFIX = "slack:";
const BOT_REALM_SEPARATOR = ":bot:";

export const TELEGRAM_IDENTITY_REALM: ChannelIdentityRealm = "telegram";

export function slackIdentityRealm(teamId: string): ChannelIdentityRealm {
  return `${SLACK_REALM_PREFIX}${teamId}`;
}

/** The realm of a Channel-owned bot Connection (every Channel but Slack). */
export function channelBotIdentityRealm(
  channel: ChannelConnectionChannel,
  connectionId: string,
): ChannelIdentityRealm {
  return CHANNEL_IDENTITY_REALM_SCOPE[channel] === "channel"
    ? channel
    : `${channel}${BOT_REALM_SEPARATOR}${connectionId}`;
}

type ParsedRealm =
  | { scope: "tenant"; teamId: string }
  | { scope: "channel"; channel: ChannelConnectionChannel }
  | { scope: "bot"; connectionId: string };

function parseIdentityRealm(realm: ChannelIdentityRealm): ParsedRealm | undefined {
  if (realm.startsWith(SLACK_REALM_PREFIX)) {
    return { scope: "tenant", teamId: realm.slice(SLACK_REALM_PREFIX.length) };
  }
  const bot = realm.indexOf(BOT_REALM_SEPARATOR);
  if (bot > 0) return { scope: "bot", connectionId: realm.slice(bot + BOT_REALM_SEPARATOR.length) };
  return realm in CHANNEL_CONNECTION_TABLES
    ? { scope: "channel", channel: realm as ChannelConnectionChannel }
    : undefined;
}

/**
 * The realm of a Connection, or `undefined` when the organization has no Channel
 * Connection by that id. Pass the Channel when the caller knows it, to read one
 * table instead of each. Queries run one after another: callers pass a
 * transaction handle, whose single client must not run queries concurrently.
 */
export async function channelConnectionIdentityRealm(
  database: DrizzleHandle,
  organizationId: string,
  connectionId: string,
  channel?: string,
): Promise<ChannelIdentityRealm | undefined> {
  // Connection ids are uuids; anything else names no Connection and must not reach a uuid cast.
  if (!UUID.test(connectionId)) return undefined;
  if (channel === undefined || channel === "slack") {
    const [slack] = await database
      .select({ teamId: schema.slackConnections.teamId })
      .from(schema.slackConnections)
      .where(
        and(
          eq(schema.slackConnections.id, connectionId),
          eq(schema.slackConnections.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (slack !== undefined) return slackIdentityRealm(slack.teamId);
  }
  for (const [candidate, table] of CHANNEL_CONNECTION_TABLE_ENTRIES) {
    if (channel !== undefined && channel !== candidate) continue;
    const [row] = await database
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, connectionId), eq(table.organizationId, organizationId)))
      .limit(1);
    if (row !== undefined) return channelBotIdentityRealm(candidate, connectionId);
  }
  return undefined;
}

/**
 * The organization's Connections in a realm: every bot a link code of that realm
 * redeems through. Sequential queries, as above.
 */
export async function identityRealmConnectionIds(
  database: DrizzleHandle,
  organizationId: string,
  realm: ChannelIdentityRealm,
): Promise<string[]> {
  const parsed = parseIdentityRealm(realm);
  if (parsed === undefined) return [];
  if (parsed.scope === "bot") return [parsed.connectionId];
  if (parsed.scope === "channel") {
    const table = CHANNEL_CONNECTION_TABLES[parsed.channel];
    const rows = await database
      .select({ id: table.id })
      .from(table)
      .where(eq(table.organizationId, organizationId));
    return rows.map(({ id }) => id);
  }
  const rows = await database
    .select({ id: schema.slackConnections.id })
    .from(schema.slackConnections)
    .where(
      and(
        eq(schema.slackConnections.organizationId, organizationId),
        eq(schema.slackConnections.teamId, parsed.teamId),
      ),
    );
  return rows.map(({ id }) => id);
}

/** Every realm the organization's Connections still reach. */
async function reachableIdentityRealms(
  database: DrizzleHandle,
  organizationId: string,
): Promise<ChannelIdentityRealm[]> {
  const slack = await database
    .selectDistinct({ teamId: schema.slackConnections.teamId })
    .from(schema.slackConnections)
    .where(eq(schema.slackConnections.organizationId, organizationId));
  const realms = new Set(slack.map(({ teamId }) => slackIdentityRealm(teamId)));
  for (const [channel, table] of CHANNEL_CONNECTION_TABLE_ENTRIES) {
    const rows = await database
      .select({ id: table.id })
      .from(table)
      .where(eq(table.organizationId, organizationId));
    for (const { id } of rows) realms.add(channelBotIdentityRealm(channel, id));
  }
  return [...realms];
}

/**
 * Removes identities whose realm no longer has any Connection. Run after a
 * Connection is deleted: removing one bot keeps the identity for the others in
 * its realm, and removing the last one leaves nothing to resolve it against.
 */
export async function deleteUnreachableChannelIdentities(
  database: DrizzleHandle,
  organizationId: string,
): Promise<void> {
  const reachable = await reachableIdentityRealms(database, organizationId);
  await database
    .delete(schema.channelIdentities)
    .where(
      and(
        eq(schema.channelIdentities.organizationId, organizationId),
        reachable.length === 0
          ? undefined
          : notInArray(schema.channelIdentities.identityRealm, reachable),
      ),
    );
}

/** The scope of an encoded realm, for copy that says how far a link reaches. */
export function identityRealmScope(realm: ChannelIdentityRealm): ChannelIdentityRealmScope {
  return parseIdentityRealm(realm)?.scope ?? "bot";
}
