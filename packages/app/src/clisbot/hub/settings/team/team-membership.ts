import type { HubCapabilities, HubMember, HubTeam } from "./types";

/** Owners have full access without a Team, so only other roles count as missing one. */
export function needsTeam(member: HubMember, teams: readonly HubTeam[]): boolean {
  return member.role !== "owner" && !teams.some(({ userIds }) => userIds.includes(member.userId));
}

/**
 * Adding people to Teams both invites (Member management) and edits Team membership (resource
 * management), so every entry point to it checks both.
 */
export function canAddPeopleToTeams(capabilities: HubCapabilities | undefined): boolean {
  return capabilities?.manageMembers === true && capabilities.manageResources;
}
