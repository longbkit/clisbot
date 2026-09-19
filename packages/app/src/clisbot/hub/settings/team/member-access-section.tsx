import { Text } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { memberNamesByUserId } from "../access-catalog";
import { AccessSummary, EMPTY_ACCESS_LEVELS, type AccessSummaryEntry } from "../access-summary";
import { countLabel } from "../labels";
import { InfoRow } from "../resource-rows";
import type { HubAssignment, HubMember, HubTeam, TeamResources } from "./types";

/** A Member's grants: direct ones, then every grant of a Team they are in, each with its source. */
export function memberAccessEntries(
  member: HubMember,
  teams: readonly HubTeam[],
  assignments: readonly HubAssignment[],
): AccessSummaryEntry[] {
  return assignments.flatMap<AccessSummaryEntry>((assignment) => {
    if (assignment.subjectKind === "member" && assignment.subjectId === member.id) {
      return [{ assignment, source: "Direct" }];
    }
    const team = teams.find(({ id }) => id === assignment.subjectId);
    if (assignment.subjectKind === "team" && team?.userIds.includes(member.userId)) {
      return [{ assignment, source: `Via ${team.name}` }];
    }
    return [];
  });
}

export function MemberAccessSection({
  member,
  teams,
  resources,
  pending,
  manageAccess,
}: {
  member: HubMember;
  teams: readonly HubTeam[];
  resources: TeamResources;
  pending: boolean;
  manageAccess(): void;
}) {
  const entries = memberAccessEntries(member, teams, resources.assignments.data?.assignments ?? []);
  const directCount = entries.filter(({ source }) => source === "Direct").length;
  return (
    <SettingsSection title="Access">
      {member.role === "owner" ? (
        <InfoRow title="Full organization access" hint="Owner · No setup required" />
      ) : (
        <>
          <AccessSummary
            entries={entries}
            resources={resources.catalog.data?.resources ?? []}
            accessLevels={resources.catalog.data?.accessLevels ?? EMPTY_ACCESS_LEVELS}
            emptyMessage="No resource access granted"
            memberNameByUserId={memberNamesByUserId(resources.members.data?.members ?? [])}
          />
          <Text style={settingsStyles.rowHint}>
            {`${countLabel(directCount, "direct assignment")}; Team access is listed with its source.`}
          </Text>
        </>
      )}
      <Button variant="outline" disabled={pending} onPress={manageAccess}>
        Manage access
      </Button>
    </SettingsSection>
  );
}
