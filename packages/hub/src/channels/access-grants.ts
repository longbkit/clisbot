// The Channel-account Access grants the channel plane reads on its own: the
// `channel.use` rows the start-time migration folds into audience rules
// (`access-migration.ts`), and the `channel.manage` check the Channel Route
// Admin API makes for a signed-in Member (`management-api/channel-admin.ts`).
// Drizzle over the shared schema, kept out of `access/store.ts` so the
// channel plane owns the reads it needs (delegation-implementation.md, row B).

import { and, eq, inArray } from "drizzle-orm";
import { AccessConstraintsSchema, formatChannelAccountResourceId } from "../access/contract.js";
import * as schema from "../db/schema.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";

/** One `channel.use` grant on a Channel account, as the migration reads it. */
export interface ChannelUseGrant {
  id: string;
  organizationId: string;
  subjectKind: "member" | "team" | "guest";
  subjectId: string;
  channel: string;
  accountId: string;
  conversation:
    | { kind: "all" }
    | { kind: "direct_messages" }
    | { kind: "public_channels" }
    | { kind: "specific"; conversationIds: string[] }
    | undefined;
}

/** What the migration job needs from the grant store; the drizzle-backed
 * implementation is below, tests use a memory one. */
export interface ChannelUseGrantSource {
  listChannelUseGrants(organizationId: string): Promise<ChannelUseGrant[]>;
  /** Removes `channel.use` from the folded rows: a Use-only row is deleted,
   * a Channel Route Admin row (`channel.manage`) keeps its Admin privilege. */
  retireChannelUse(ids: readonly string[]): Promise<void>;
}

/** `<channel>/<accountId>` as `formatChannelAccountResourceId` writes it. */
export function parseChannelAccountResourceId(
  resourceId: string,
): { channel: string; accountId: string } | undefined {
  const separator = resourceId.indexOf("/");
  if (separator <= 0 || separator === resourceId.length - 1) return undefined;
  return {
    channel: decodeURIComponent(resourceId.slice(0, separator)),
    accountId: decodeURIComponent(resourceId.slice(separator + 1)),
  };
}

export function createChannelUseGrantSource(runtime: DatabaseRuntime): ChannelUseGrantSource {
  const database = runtime.drizzle();
  return {
    async listChannelUseGrants(organizationId) {
      const rows = await database
        .select()
        .from(schema.accessAssignments)
        .where(
          and(
            eq(schema.accessAssignments.organizationId, organizationId),
            eq(schema.accessAssignments.resourceKind, "channel_account"),
          ),
        );
      const grants: ChannelUseGrant[] = [];
      for (const row of rows) {
        if (!row.privileges.includes("channel.use")) continue;
        const account = parseChannelAccountResourceId(row.resourceId);
        if (account === undefined) continue;
        const constraints = AccessConstraintsSchema.safeParse(row.constraints);
        grants.push({
          id: row.id,
          organizationId: row.organizationId,
          subjectKind: row.subjectKind,
          subjectId: row.subjectId,
          ...account,
          conversation: constraints.success ? constraints.data.conversation : undefined,
        });
      }
      return grants;
    },
    async retireChannelUse(ids) {
      if (ids.length === 0) return;
      const rows = await database
        .select()
        .from(schema.accessAssignments)
        .where(inArray(schema.accessAssignments.id, [...ids]));
      for (const row of rows) {
        const kept = row.privileges.filter((privilege) => privilege !== "channel.use");
        if (kept.length === 0) {
          await database
            .delete(schema.accessAssignments)
            .where(eq(schema.accessAssignments.id, row.id));
          continue;
        }
        await database
          .update(schema.accessAssignments)
          .set({ privileges: kept })
          .where(eq(schema.accessAssignments.id, row.id));
      }
    },
  };
}

/** The Teams a user belongs to in one organization. */
export async function memberTeamIds(
  runtime: DatabaseRuntime,
  organizationId: string,
  userId: string,
): Promise<string[]> {
  const rows = await runtime
    .drizzle()
    .select({ id: schema.teams.id })
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
    .where(
      and(eq(schema.teamMembers.userId, userId), eq(schema.teams.organizationId, organizationId)),
    );
  return rows.map(({ id }) => id);
}

/**
 * Whether a Member holds `channel.manage` on one Channel account, directly or
 * through a Team. The organization capability is the caller's to check first;
 * this is the delegated grant only (docs/features/access/scoped-admins.md).
 */
export async function holdsChannelAccountManagement(
  runtime: DatabaseRuntime,
  input: {
    organizationId: string;
    membershipId: string;
    userId: string;
    channel: string;
    accountId: string;
  },
): Promise<boolean> {
  const teams = await memberTeamIds(runtime, input.organizationId, input.userId);
  const rows = await runtime
    .drizzle()
    .select({
      subjectKind: schema.accessAssignments.subjectKind,
      subjectId: schema.accessAssignments.subjectId,
      privileges: schema.accessAssignments.privileges,
    })
    .from(schema.accessAssignments)
    .where(
      and(
        eq(schema.accessAssignments.organizationId, input.organizationId),
        eq(schema.accessAssignments.resourceKind, "channel_account"),
        eq(
          schema.accessAssignments.resourceId,
          formatChannelAccountResourceId(input.channel, input.accountId),
        ),
      ),
    );
  return rows.some(
    (row) =>
      row.privileges.includes("channel.manage") &&
      ((row.subjectKind === "member" && row.subjectId === input.membershipId) ||
        (row.subjectKind === "team" && teams.includes(row.subjectId))),
  );
}
