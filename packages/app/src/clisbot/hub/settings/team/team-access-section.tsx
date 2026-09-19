import { useMemo } from "react";
import { Text } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { SubjectGrantsTable } from "../subject-grants-table";
import { ResourceFeedbackGroup } from "../resource-rows";
import type {
  HubAccessLevels,
  HubAccessResource,
  HubAssignment,
  HubMember,
  HubTeam,
  TeamResources,
} from "./types";
import { useTeamAccess } from "./use-people-resources";

const NO_MEMBERS: HubMember[] = [];
const NO_ASSIGNMENTS: HubAssignment[] = [];
const NO_RESOURCES: HubAccessResource[] = [];
const NO_LEVELS: HubAccessLevels = {};

/**
 * A Team's grants. Organization Admins read them from the organization's assignments and can
 * go change them; a Team Admin reads the Team's own grants and cannot change them.
 */
export function TeamAccessSection({
  team,
  resources,
  pending,
  manageAccess,
}: {
  team: HubTeam;
  resources: TeamResources;
  pending: boolean;
  manageAccess(): void;
}) {
  const members = resources.members.data?.members ?? NO_MEMBERS;
  const teams = useMemo(() => [team], [team]);
  const manage = useMemo(
    () => (
      <Button size="sm" variant="outline" disabled={pending} onPress={manageAccess}>
        Manage access
      </Button>
    ),
    [manageAccess, pending],
  );
  if (!resources.canManageResources) {
    return <TeamAdminAccess team={team} teams={teams} members={members} />;
  }
  return (
    <SettingsSection
      title="Access"
      info="What every Member of this Team can use. A change here reaches all of them."
      trailing={manage}
    >
      <SubjectGrantsTable
        subjectKind="team"
        subjectId={team.id}
        assignments={resources.assignments.data?.assignments ?? NO_ASSIGNMENTS}
        resources={resources.catalog.data?.resources ?? NO_RESOURCES}
        accessLevels={resources.catalog.data?.accessLevels ?? NO_LEVELS}
        members={members}
        teams={teams}
        empty="No access yet. Grant some with Manage access."
      />
    </SettingsSection>
  );
}

function TeamAdminAccess({
  team,
  teams,
  members,
}: {
  team: HubTeam;
  teams: readonly HubTeam[];
  members: readonly HubMember[];
}) {
  const access = useTeamAccess(team.id);
  return (
    <SettingsSection title="Access">
      <ResourceFeedbackGroup queries={[access]} />
      {access.data === undefined ? null : (
        <SubjectGrantsTable
          subjectKind="team"
          subjectId={team.id}
          assignments={access.data.assignments}
          resources={access.data.resources}
          accessLevels={access.data.accessLevels}
          members={members}
          teams={teams}
          empty="No resource access granted"
        />
      )}
      <Text style={settingsStyles.rowHint}>
        Team Admins manage who is in the Team. An Organization Admin changes what the Team can use.
      </Text>
    </SettingsSection>
  );
}
