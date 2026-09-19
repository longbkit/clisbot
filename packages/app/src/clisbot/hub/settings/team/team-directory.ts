import { invitationTeams } from "../../contracts";
import { resourceKindLabel, subjectAssignments } from "../access-catalog";
import { countLabel } from "../labels";
import { matchesSearch } from "../search-text";
import type { HubAssignment, HubManagedInvitation, HubTeam } from "./types";

export interface TeamDirectoryRow {
  team: HubTeam;
  invitationCount: number;
  /** Undefined when the viewer cannot read access assignments. */
  access: string | undefined;
}

/** "2 Hosts · 1 Project", or "No access" when the Team grants nothing. */
export function teamAccessLine(assignments: readonly HubAssignment[]): string {
  const counts = new Map<HubAssignment["resourceKind"], number>();
  for (const { resourceKind } of assignments) {
    counts.set(resourceKind, (counts.get(resourceKind) ?? 0) + 1);
  }
  if (counts.size === 0) return "No access";
  return Array.from(counts, ([kind, count]) => countLabel(count, resourceKindLabel(kind))).join(
    " · ",
  );
}

export function teamDirectoryRows(
  teams: readonly HubTeam[],
  invitations: readonly HubManagedInvitation[],
  assignments: readonly HubAssignment[] | undefined,
  query: string,
): TeamDirectoryRow[] {
  return teams
    .filter((team) => matchesSearch(query, [team.name]))
    .map((team) => ({
      team,
      invitationCount: invitations.filter((invitation) =>
        invitationTeams(invitation).some(({ id }) => id === team.id),
      ).length,
      access:
        assignments === undefined
          ? undefined
          : teamAccessLine(subjectAssignments(assignments, "team", team.id)),
    }));
}
