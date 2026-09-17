import { and, eq, notInArray } from "drizzle-orm";
import * as schema from "../db/schema.js";
import type { DrizzleHandle } from "../db/runtime/index.js";

/**
 * The set of Connections across which one provider sender id names one person,
 * so a Channel identity is verified once per realm rather than once per bot.
 *
 * - Slack: one workspace (`slack:<team id>`). Every app installed in a workspace
 *   sees the same user id; ids from unrelated workspaces prove nothing about
 *   each other, so they never share a realm.
 * - Telegram: one realm. A Telegram user id is the same for every bot.
 */
export type ChannelIdentityRealm = string;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const TELEGRAM_IDENTITY_REALM: ChannelIdentityRealm = "telegram";

export function slackIdentityRealm(teamId: string): ChannelIdentityRealm {
  return `slack:${teamId}`;
}

/**
 * The realm of a linkable Connection, or `undefined` when the organization has no such Connection.
 * Queries run one after another: callers pass a transaction handle, whose single
 * client must not run queries concurrently.
 */
export async function channelConnectionIdentityRealm(
  database: DrizzleHandle,
  organizationId: string,
  connectionId: string,
): Promise<ChannelIdentityRealm | undefined> {
  // Connection ids are uuids; anything else names no Connection and must not reach a uuid cast.
  if (!UUID.test(connectionId)) return undefined;
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
  const [telegram] = await database
    .select({ id: schema.telegramConnections.id })
    .from(schema.telegramConnections)
    .where(
      and(
        eq(schema.telegramConnections.id, connectionId),
        eq(schema.telegramConnections.organizationId, organizationId),
      ),
    )
    .limit(1);
  return telegram === undefined ? undefined : TELEGRAM_IDENTITY_REALM;
}

/**
 * Removes identities whose realm no longer has any Connection. Run after a
 * Connection is deleted: removing one bot keeps the identity for the others in
 * its workspace, and removing the last one leaves nothing to resolve it against.
 */
export async function deleteUnreachableChannelIdentities(
  database: DrizzleHandle,
  organizationId: string,
): Promise<void> {
  const slack = await database
    .selectDistinct({ teamId: schema.slackConnections.teamId })
    .from(schema.slackConnections)
    .where(eq(schema.slackConnections.organizationId, organizationId));
  const telegram = await database
    .select({ id: schema.telegramConnections.id })
    .from(schema.telegramConnections)
    .where(eq(schema.telegramConnections.organizationId, organizationId))
    .limit(1);
  const reachable = [
    ...slack.map(({ teamId }) => slackIdentityRealm(teamId)),
    ...(telegram.length > 0 ? [TELEGRAM_IDENTITY_REALM] : []),
  ];
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
