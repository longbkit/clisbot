import { i18n } from "@/i18n/i18next";
import { invitationTeams } from "../../contracts";
import { subjectAssignments } from "../access-catalog";
import { matchesSearch } from "../search-text";
import type { HubAssignment, HubManagedInvitation, HubTeam } from "./types";

export interface TeamDirectoryRow {
  team: HubTeam;
  invitationCount: number;
  /** What the Team grants; undefined when the viewer cannot read access assignments. */
  access: readonly HubAssignment[] | undefined;
}

/** `2 Hosts`, `1 Project`: one resource kind counted, in the UI language. */
function resourceKindCount(kind: HubAssignment["resourceKind"], count: number): string {
  switch (kind) {
    case "organization":
      return i18n.t("hub.team.access.organizations", { count });
    case "daemon":
      return i18n.t("hub.team.access.hosts", { count });
    case "project":
      return i18n.t("hub.team.access.projects", { count });
    case "team":
      return i18n.t("hub.team.access.teams", { count });
    case "channel_account":
      return i18n.t("hub.team.access.connections", { count });
    case "automation":
      return i18n.t("hub.team.access.automations", { count });
  }
}

/** "2 Hosts · 1 Project", or "No access" when the Team grants nothing. */
export function teamAccessLine(assignments: readonly HubAssignment[]): string {
  const counts = new Map<HubAssignment["resourceKind"], number>();
  for (const { resourceKind } of assignments) {
    counts.set(resourceKind, (counts.get(resourceKind) ?? 0) + 1);
  }
  if (counts.size === 0) return i18n.t("hub.team.access.none");
  return Array.from(counts, ([kind, count]) => resourceKindCount(kind, count)).join(" · ");
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
        assignments === undefined ? undefined : subjectAssignments(assignments, "team", team.id),
    }));
}
