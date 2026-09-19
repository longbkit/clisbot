// The Channel-account Access grant the channel plane reads on its own: the
// `channel.manage` check the Channel Route Admin API makes for a signed-in
// Member (`management-api/channel-admin.ts`).
// Drizzle over the shared schema, kept out of `access/store.ts` so the
// channel plane owns the reads it needs (delegation-implementation.md, row B).

import { and, eq } from "drizzle-orm";
import { formatChannelAccountResourceId } from "../access/contract.js";
import * as schema from "../db/schema.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";

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
export function holdsChannelAccountManagement(
  runtime: DatabaseRuntime,
  input: {
    organizationId: string;
    membershipId: string;
    userId: string;
    channel: string;
    accountId: string;
  },
): Promise<boolean> {
  return holdsManagement(
    runtime,
    input,
    formatChannelAccountResourceId(input.channel, input.accountId),
  );
}

/** Whether a Member is Channel Route Admin of any account (the channel catalog
 * and other account-neutral reads a Route Admin's screens need). */
export function holdsAnyChannelAccountManagement(
  runtime: DatabaseRuntime,
  input: { organizationId: string; membershipId: string; userId: string },
): Promise<boolean> {
  return holdsManagement(runtime, input, undefined);
}

async function holdsManagement(
  runtime: DatabaseRuntime,
  input: { organizationId: string; membershipId: string; userId: string },
  resourceId: string | undefined,
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
        resourceId === undefined ? undefined : eq(schema.accessAssignments.resourceId, resourceId),
      ),
    );
  return rows.some(
    (row) =>
      row.privileges.includes("channel.manage") &&
      ((row.subjectKind === "member" && row.subjectId === input.membershipId) ||
        (row.subjectKind === "team" && teams.includes(row.subjectId))),
  );
}
