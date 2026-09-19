import { useMemo } from "react";
import { View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { subjectAssignments } from "../access-catalog";
import { countLabel } from "../labels";
import { InfoRow } from "../resource-rows";
import { SubjectGrantsTable } from "../subject-grants-table";
import type {
  HubAccessLevels,
  HubAccessResource,
  HubAssignment,
  HubMember,
  HubTeam,
  TeamResources,
} from "./types";

const NO_MEMBERS: HubMember[] = [];
const NO_ASSIGNMENTS: HubAssignment[] = [];
const NO_RESOURCES: HubAccessResource[] = [];
const NO_LEVELS: HubAccessLevels = {};

/** A Member's grants: direct ones, then every grant of a Team they are in, marked via that Team. */
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
  const assignments = resources.assignments.data?.assignments ?? NO_ASSIGNMENTS;
  const directCount = subjectAssignments(assignments, "member", member.id).length;
  const manage = useMemo(
    () => (
      <Button size="sm" variant="outline" disabled={pending} onPress={manageAccess}>
        Manage access
      </Button>
    ),
    [manageAccess, pending],
  );
  return (
    <SettingsSection
      title="Access"
      info={`What ${member.name} can use: ${countLabel(directCount, "direct grant")}, and their Teams' grants marked with the Team.`}
      trailing={manage}
    >
      {member.role === "owner" ? (
        <View style={settingsStyles.card}>
          <InfoRow title="Everything" hint="An Owner's access is automatic; no grant is needed." />
        </View>
      ) : (
        <SubjectGrantsTable
          subjectKind="member"
          subjectId={member.id}
          assignments={assignments}
          resources={resources.catalog.data?.resources ?? NO_RESOURCES}
          accessLevels={resources.catalog.data?.accessLevels ?? NO_LEVELS}
          members={resources.members.data?.members ?? NO_MEMBERS}
          teams={teams}
          empty="No access yet. Grant some, or add them to a Team that has it."
        />
      )}
    </SettingsSection>
  );
}
