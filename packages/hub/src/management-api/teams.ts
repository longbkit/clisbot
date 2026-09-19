/**
 * Team management for the organization-scoped management contract (`teams`).
 * Creating, renaming, and deleting a Team stays with Organization Admins. Who is
 * in a Team is also open to its Team Admins: Members holding
 * `hub.access.manage` on `team:<id>` (docs/features/access/scoped-admins.md),
 * who also read the Team's grants (`GET teams/:id/access`) without changing them.
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { RESOURCE_ACCESS_LEVELS } from "../access/contract.js";
import type { AccessResourceRecord, AccessStore } from "../access/store.js";
import { ProductRequestError, type OrganizationAccessValue } from "../auth/organization-access.js";
import type { OrganizationTeamDirectory } from "../auth/team-directory.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import { parseBody, problem } from "./request.js";

const teamRequestSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const teamMemberRequestSchema = z.object({ userId: z.string().min(1) }).strict();

export interface TeamsApiDependencies {
  runtime: DatabaseRuntime;
  access: AccessStore;
  teams: OrganizationTeamDirectory;
  requireMutation: (request: Request) => void;
  revokeOrganizationAccessLeases: (organizationId: string) => Promise<void>;
}

export class TeamsApi {
  constructor(private readonly deps: TeamsApiDependencies) {}

  async handle(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    const organizationId = access.organization.id;
    if (request.method === "GET" && segments.length === 3) {
      return this.listTeams(organizationId);
    }
    if (request.method === "GET" && segments.length === 5 && segments[4] === "access") {
      const teamId = segments[3]!;
      await this.requireTeamMembershipAuthority(access, teamId);
      return this.teamAccess(requestId, organizationId, teamId);
    }
    this.deps.requireMutation(request);
    if (request.method === "POST" && segments.length === 3) {
      requireOrganizationAdmin(access);
      return this.createTeam(request, organizationId);
    }
    const teamId = segments[3];
    if (teamId === undefined) return notFound(requestId);
    if (segments[4] === "members") {
      await this.requireTeamMembershipAuthority(access, teamId);
      if (segments.length === 5 && request.method === "POST") {
        return this.addTeamMember(request, requestId, organizationId, teamId);
      }
      const userId = segments[5];
      if (userId !== undefined && segments.length === 6 && request.method === "DELETE") {
        return this.removeTeamMember(requestId, organizationId, teamId, userId);
      }
      return notFound(requestId);
    }
    requireOrganizationAdmin(access);
    if (request.method === "PUT" && segments.length === 4) {
      return this.renameTeam(request, requestId, organizationId, teamId);
    }
    if (request.method === "DELETE" && segments.length === 4) {
      return this.removeTeam(requestId, organizationId, teamId);
    }
    return notFound(requestId);
  }

  /** An Organization Admin, or a Team Admin of this Team. */
  private async requireTeamMembershipAuthority(
    access: OrganizationAccessValue,
    teamId: string,
  ): Promise<void> {
    if (access.capabilities.manageResources) return;
    const administered = await this.deps.access.listTeamsAdministeredBy(access.organization.id, {
      membershipId: access.membership.id,
      userId: access.account.id,
    });
    if (!administered.includes(teamId)) throw new ProductRequestError(403, "forbidden");
  }

  private async createTeam(request: Request, organizationId: string): Promise<Response> {
    const input = await parseBody(request, teamRequestSchema);
    const team = await this.deps.teams.create(organizationId, input.name);
    await this.deps.revokeOrganizationAccessLeases(organizationId);
    return Response.json(serializeTeam(team, []), { status: 201 });
  }

  private async renameTeam(
    request: Request,
    requestId: string,
    organizationId: string,
    teamId: string,
  ): Promise<Response> {
    const input = await parseBody(request, teamRequestSchema);
    const team = await this.deps.teams.rename(organizationId, teamId, input.name);
    if (team === undefined) {
      return problem(requestId, 404, "team_unavailable", "Team is unavailable.");
    }
    await this.deps.revokeOrganizationAccessLeases(organizationId);
    const current = await this.listTeamUserIds(organizationId, teamId);
    return Response.json(serializeTeam(team, current));
  }

  private async removeTeam(
    requestId: string,
    organizationId: string,
    teamId: string,
  ): Promise<Response> {
    const deleted = await this.deps.teams.remove(organizationId, teamId);
    if (!deleted) {
      return problem(requestId, 404, "team_unavailable", "Team is unavailable.");
    }
    await this.deps.revokeOrganizationAccessLeases(organizationId);
    return new Response(null, { status: 204 });
  }

  private async addTeamMember(
    request: Request,
    requestId: string,
    organizationId: string,
    teamId: string,
  ): Promise<Response> {
    const input = await parseBody(request, teamMemberRequestSchema);
    const membership = await this.deps.teams.addMember(organizationId, teamId, input.userId);
    if (membership === undefined) {
      return problem(
        requestId,
        404,
        "team_or_member_unavailable",
        "Team or Member is unavailable.",
      );
    }
    await this.deps.revokeOrganizationAccessLeases(organizationId);
    return Response.json(
      {
        id: membership.id,
        teamId: membership.teamId,
        userId: membership.userId,
        createdAt: membership.createdAt.toISOString(),
      },
      { status: 201 },
    );
  }

  private async removeTeamMember(
    requestId: string,
    organizationId: string,
    teamId: string,
    userId: string,
  ): Promise<Response> {
    const removed = await this.deps.teams.removeMember(organizationId, teamId, userId);
    if (!removed) {
      return problem(
        requestId,
        404,
        "team_membership_unavailable",
        "Team membership is unavailable.",
      );
    }
    await this.deps.revokeOrganizationAccessLeases(organizationId);
    return new Response(null, { status: 204 });
  }

  /**
   * The Team's grants, read-only, with the resources they name (and their parents) so a
   * Team Admin who cannot read the access catalog still sees names and levels.
   */
  private async teamAccess(
    requestId: string,
    organizationId: string,
    teamId: string,
  ): Promise<Response> {
    const [team] = await this.deps.runtime
      .drizzle()
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(and(eq(schema.teams.organizationId, organizationId), eq(schema.teams.id, teamId)));
    if (team === undefined) {
      return problem(requestId, 404, "team_unavailable", "Team is unavailable.");
    }
    const [assignments, resources] = await Promise.all([
      this.deps.access.listAssignments(organizationId),
      this.deps.access.listResources(organizationId),
    ]);
    const granted = assignments.filter(
      ({ subjectKind, subjectId }) => subjectKind === "team" && subjectId === teamId,
    );
    return Response.json({
      assignments: granted.map((assignment) => ({
        ...assignment,
        createdAt: assignment.createdAt.toISOString(),
        updatedAt: assignment.updatedAt.toISOString(),
      })),
      resources: namedResources(granted, resources),
      accessLevels: RESOURCE_ACCESS_LEVELS,
    });
  }

  private async listTeams(organizationId: string): Promise<Response> {
    const database = this.deps.runtime.drizzle();
    const [teams, memberships] = await Promise.all([
      database
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.organizationId, organizationId))
        .orderBy(asc(schema.teams.name)),
      database
        .select({
          teamId: schema.teamMembers.teamId,
          userId: schema.teamMembers.userId,
        })
        .from(schema.teamMembers)
        .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
        .where(eq(schema.teams.organizationId, organizationId)),
    ]);
    return Response.json({
      teams: teams.map((team) =>
        serializeTeam(
          team,
          memberships.filter(({ teamId }) => teamId === team.id).map(({ userId }) => userId),
        ),
      ),
    });
  }

  private async listTeamUserIds(organizationId: string, teamId: string): Promise<string[]> {
    return (
      await this.deps.runtime
        .drizzle()
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
        .where(and(eq(schema.teams.organizationId, organizationId), eq(schema.teams.id, teamId)))
    ).map(({ userId }) => userId);
  }
}

function requireOrganizationAdmin(access: OrganizationAccessValue): void {
  if (!access.capabilities.manageResources) throw new ProductRequestError(403, "forbidden");
}

/** The resources the grants name, plus their parents, without the Agent catalog. */
function namedResources(
  granted: readonly { resourceKind: string; resourceId: string }[],
  resources: readonly AccessResourceRecord[],
) {
  const named = resources.filter(({ kind, id }) =>
    granted.some(({ resourceKind, resourceId }) => resourceKind === kind && resourceId === id),
  );
  const parents = resources.filter(({ kind, id }) =>
    named.some(({ parent }) => parent?.kind === kind && parent.id === id),
  );
  return [...new Set([...named, ...parents])].map(({ kind, id, name, parent, available }) => ({
    kind,
    id,
    name,
    parent,
    available,
  }));
}

function notFound(requestId: string): Response {
  return problem(requestId, 404, "not_found", "No management resource matches this path.");
}

function serializeTeam(team: typeof schema.teams.$inferSelect, userIds: readonly string[]) {
  return {
    id: team.id,
    name: team.name,
    userIds,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt?.toISOString() ?? null,
  };
}
