import { and, eq } from "drizzle-orm";
import type { VerifiedSessionOperationIdentity } from "@getpaseo/protocol/session-operation";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import { members, users } from "../db/schema.js";

/** Called only with the Member established by public-operation authorization, never payload.actor. */
export async function automationMemberIdentity(
  runtime: DatabaseRuntime | undefined,
  organizationId: string,
  membershipId: string,
  hubOrigin: string | undefined,
): Promise<VerifiedSessionOperationIdentity> {
  if (!runtime || !hubOrigin)
    throw new Error("Verified Automation initiator storage is unavailable");
  const [member] = await runtime
    .drizzle()
    .select({ id: users.id, name: users.name, image: users.image })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.id, membershipId), eq(members.organizationId, organizationId)))
    .limit(1);
  if (!member) throw new Error("Automation initiator is no longer a Member");
  return {
    actor: {
      kind: "user",
      id: member.id,
      organizationId,
      memberId: membershipId,
      hubOrigin: new URL(hubOrigin).origin,
      ...(member.name ? { displayName: member.name } : {}),
      ...(member.image ? { avatarUrl: member.image } : {}),
    },
  };
}
