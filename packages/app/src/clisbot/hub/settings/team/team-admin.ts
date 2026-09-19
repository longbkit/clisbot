import type { HubAssignment, HubMember } from "./types";

/**
 * Team Admin is `hub.access.manage` on resource kind `team`. The People screen reads
 * assignments with `?include=team` so these rows arrive; a Hub without Team resources
 * answers without them, and the dropdown learns that from the first refused write.
 */
export const TEAM_RESOURCE_KIND = "team" as const;
export const TEAM_ADMIN_PRIVILEGE = "hub.access.manage";

export type TeamRole = "admin" | "member";

/** The assignment that makes this Member a Team Admin, when one exists. */
export function teamAdminAssignment(
  assignments: readonly HubAssignment[],
  teamId: string,
  member: Pick<HubMember, "id">,
): HubAssignment | undefined {
  return assignments.find(
    (assignment) =>
      assignment.resourceKind === TEAM_RESOURCE_KIND &&
      assignment.resourceId === teamId &&
      assignment.subjectKind === "member" &&
      assignment.subjectId === member.id &&
      assignment.privileges.includes(TEAM_ADMIN_PRIVILEGE),
  );
}

export function teamRoleOf(
  assignments: readonly HubAssignment[],
  teamId: string,
  member: Pick<HubMember, "id">,
): TeamRole {
  return teamAdminAssignment(assignments, teamId, member) === undefined ? "member" : "admin";
}

/** The body that grants Team Admin, in the shape the assignments endpoint takes. */
export function teamAdminGrant(teamId: string, member: Pick<HubMember, "id">) {
  return {
    subjectKind: "member" as const,
    subjectId: member.id,
    resourceKind: TEAM_RESOURCE_KIND,
    resourceId: teamId,
    privileges: [TEAM_ADMIN_PRIVILEGE],
    constraints: {},
  };
}
