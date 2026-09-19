import type { z } from "zod";
import type { HubEffectiveAccessSchema } from "../../contracts";
import { TEAM_ADMIN_PRIVILEGE, TEAM_RESOURCE_KIND } from "./team-admin";
import type { HubCapabilities, HubMember, HubTeam, PeopleAuthority } from "./types";

/** Owners have full access without a Team, so only other roles count as missing one. */
export function needsTeam(member: HubMember, teams: readonly HubTeam[]): boolean {
  return member.role !== "owner" && !teams.some(({ userIds }) => userIds.includes(member.userId));
}

/**
 * Adding people to any Team both invites (Member management) and edits Team membership
 * (resource management), so the organization-wide entry points check both.
 */
function canAddPeopleToTeams(capabilities: HubCapabilities | undefined): boolean {
  return capabilities?.manageMembers === true && capabilities.manageResources;
}

/** The Teams the viewer is Team Admin of, from their own effective grants (direct or via a Team). */
export function administeredTeamIds(
  effective: z.infer<typeof HubEffectiveAccessSchema> | undefined,
): ReadonlySet<string> {
  return new Set(
    (effective?.grants ?? [])
      .filter(
        ({ resource, privileges }) =>
          resource.kind === TEAM_RESOURCE_KIND && privileges.includes(TEAM_ADMIN_PRIVILEGE),
      )
      .map(({ resource }) => resource.id),
  );
}

/** Add, remove, and appoint Team Admins in this Team: Organization Admins and its Team Admins. */
export function canManageTeamMembership(authority: PeopleAuthority, teamId: string): boolean {
  return (
    authority.capabilities?.manageResources === true || authority.administeredTeamIds.has(teamId)
  );
}

/** Invite people into this Team, or into any Team the viewer may invite into when none is named. */
/** Whether the viewer manages anyone here: the organization's people, or a Team they administer. */
export function managesPeople(authority: PeopleAuthority): boolean {
  return (
    authority.capabilities?.manageMembers === true ||
    authority.capabilities?.manageResources === true ||
    authority.administeredTeamIds.size > 0
  );
}

export function canInvitePeople(authority: PeopleAuthority, teamId?: string): boolean {
  if (canAddPeopleToTeams(authority.capabilities)) return true;
  return teamId === undefined
    ? authority.administeredTeamIds.size > 0
    : authority.administeredTeamIds.has(teamId);
}

/** A Team Admin invites only as Member; the Hub refuses any other role from them. */
export function inviteRoleLocked(authority: PeopleAuthority): boolean {
  return authority.capabilities?.manageMembers !== true;
}

/** The Teams the Invite people modal offers: every Team, or only the ones the viewer administers. */
export function invitableTeams(
  authority: PeopleAuthority,
  teams: readonly HubTeam[],
): readonly HubTeam[] {
  if (canAddPeopleToTeams(authority.capabilities)) return teams;
  return teams.filter(({ id }) => authority.administeredTeamIds.has(id));
}

/**
 * The Teams People shows. Organization Admins see every Team; anyone else sees the Teams they
 * belong to or administer. The Hub still lists every Team, because the Access form and Route
 * audience rules name Teams the viewer is not in.
 */
export function visibleTeams(
  authority: PeopleAuthority,
  teams: readonly HubTeam[],
  viewerUserId: string | undefined,
): HubTeam[] {
  const capabilities = authority.capabilities;
  if (capabilities?.manageResources === true || capabilities?.manageMembers === true) {
    return [...teams];
  }
  return teams.filter(
    ({ id, userIds }) =>
      authority.administeredTeamIds.has(id) ||
      (viewerUserId !== undefined && userIds.includes(viewerUserId)),
  );
}

/**
 * Invitations are listed to Organization Admins and to Team Admins; the Hub lists a Team Admin
 * only the invitations they could send (role Member, into their Teams), which they may also
 * resend or cancel.
 */
export function canSeeInvitations(authority: PeopleAuthority): boolean {
  return authority.capabilities?.manageMembers === true || authority.administeredTeamIds.size > 0;
}
