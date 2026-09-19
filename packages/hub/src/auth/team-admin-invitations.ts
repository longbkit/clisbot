/**
 * What a Team Admin (`hub.access.manage` on `team:<id>`,
 * docs/features/access/scoped-admins.md) may do with invitations. One rule for
 * sending, resending, listing, and cancelling: the invitation's role is
 * `member` and every Team it names is one the actor administers.
 */
import { AccessStore } from "../access/store.js";
import type { DatabaseRuntime, QueryHandle, QueryRow } from "../db/runtime/index.js";
import type { OrganizationAccessValue } from "./organization-access.js";

type DrizzleHandle = Parameters<AccessStore["listTeamsAdministeredBy"]>[2];

export function teamAdminCoversInvitation(
  role: string,
  teamIds: readonly string[],
  administeredTeamIds: readonly string[],
): boolean {
  return (
    role === "member" &&
    teamIds.length > 0 &&
    teamIds.every((teamId) => administeredTeamIds.includes(teamId))
  );
}

/** The Teams the actor administers, read inside the caller's transaction when given one. */
export function teamsAdministeredBy(
  pool: DatabaseRuntime,
  access: OrganizationAccessValue,
  database?: DrizzleHandle,
): Promise<string[]> {
  return new AccessStore(pool).listTeamsAdministeredBy(
    access.organization.id,
    { membershipId: access.membership.id, userId: access.account.id },
    database,
  );
}

interface InvitationScopeRow extends QueryRow {
  role: string;
  team_ids: string[] | null;
}

/** The role and Team ids of one pending invitation of the organization, or undefined. */
export async function pendingInvitationScope(
  client: QueryHandle,
  organizationId: string,
  invitationId: string,
): Promise<{ role: string; teamIds: string[] } | undefined> {
  const result = await client.query<InvitationScopeRow>(
    `select invitation.role,
            (select json_agg(invitation_teams.team_id) from invitation_teams
             where invitation_teams.invitation_id = invitation.id) as team_ids
     from invitation
     where invitation.id = $1 and invitation.organization_id = $2
       and invitation.status = 'pending'`,
    [invitationId, organizationId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : { role: row.role, teamIds: row.team_ids ?? [] };
}
