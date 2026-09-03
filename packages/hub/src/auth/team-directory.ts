import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";

/**
 * Organization-scoped adapter over BetterAuth's Team tables.
 * BetterAuth remains the schema owner; resource grants stay in AccessStore.
 */
export class OrganizationTeamDirectory {
  constructor(private readonly runtime: DatabaseRuntime) {}

  async create(organizationId: string, name: string) {
    const now = new Date();
    const [team] = await this.runtime
      .drizzle()
      .insert(schema.teams)
      .values({ id: randomUUID(), organizationId, name, createdAt: now, updatedAt: now })
      .returning();
    if (team === undefined) throw new Error("Team creation did not return a record");
    return team;
  }

  async rename(organizationId: string, teamId: string, name: string) {
    const [team] = await this.runtime
      .drizzle()
      .update(schema.teams)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(schema.teams.id, teamId), eq(schema.teams.organizationId, organizationId)))
      .returning();
    return team;
  }

  async remove(organizationId: string, teamId: string): Promise<boolean> {
    return this.runtime.transaction(async (handle) => {
      const database = handle.drizzle();
      const [team] = await database
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(and(eq(schema.teams.id, teamId), eq(schema.teams.organizationId, organizationId)))
        .limit(1);
      if (team === undefined) return false;
      await database
        .delete(schema.accessAssignments)
        .where(
          and(
            eq(schema.accessAssignments.organizationId, organizationId),
            eq(schema.accessAssignments.subjectKind, "team"),
            eq(schema.accessAssignments.subjectId, teamId),
          ),
        );
      await database.delete(schema.teams).where(eq(schema.teams.id, teamId));
      return true;
    });
  }

  async addMember(organizationId: string, teamId: string, userId: string) {
    return this.runtime.transaction(async (handle) => {
      const database = handle.drizzle();
      const [eligible] = await database
        .select({ teamId: schema.teams.id })
        .from(schema.teams)
        .innerJoin(
          schema.members,
          and(
            eq(schema.members.organizationId, schema.teams.organizationId),
            eq(schema.members.userId, userId),
          ),
        )
        .where(and(eq(schema.teams.id, teamId), eq(schema.teams.organizationId, organizationId)))
        .limit(1);
      if (eligible === undefined) return undefined;
      const [membership] = await database
        .insert(schema.teamMembers)
        .values({ id: randomUUID(), teamId, userId })
        .onConflictDoNothing({ target: [schema.teamMembers.teamId, schema.teamMembers.userId] })
        .returning();
      if (membership !== undefined) return membership;
      const [existing] = await database
        .select()
        .from(schema.teamMembers)
        .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)))
        .limit(1);
      return existing;
    });
  }

  async removeMember(organizationId: string, teamId: string, userId: string): Promise<boolean> {
    return this.runtime.transaction(async (handle) => {
      const database = handle.drizzle();
      const [team] = await database
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(and(eq(schema.teams.id, teamId), eq(schema.teams.organizationId, organizationId)))
        .limit(1);
      if (team === undefined) return false;
      const removed = await database
        .delete(schema.teamMembers)
        .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)))
        .returning({ id: schema.teamMembers.id });
      return removed.length > 0;
    });
  }
}
