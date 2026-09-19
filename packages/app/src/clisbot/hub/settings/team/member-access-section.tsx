import { Text } from "react-native";
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
  return (
    <SettingsSection title="Access">
      {member.role === "owner" ? (
        <InfoRow title="Full organization access" hint="Owner · No setup required" />
      ) : (
        <>
          <SubjectGrantsTable
            subjectKind="member"
            subjectId={member.id}
            assignments={assignments}
            resources={resources.catalog.data?.resources ?? NO_RESOURCES}
            accessLevels={resources.catalog.data?.accessLevels ?? NO_LEVELS}
            members={resources.members.data?.members ?? NO_MEMBERS}
            teams={teams}
            empty="No resource access granted"
          />
          <Text style={settingsStyles.rowHint}>
            {`${countLabel(directCount, "direct assignment")}; Team access is marked with its Team.`}
          </Text>
        </>
      )}
      <Button variant="outline" disabled={pending} onPress={manageAccess}>
        Manage access
      </Button>
    </SettingsSection>
  );
}
