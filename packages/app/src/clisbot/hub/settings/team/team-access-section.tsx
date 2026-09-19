import { Text } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { memberNamesByUserId } from "../access-catalog";
import { AccessSummary, EMPTY_ACCESS_LEVELS, subjectAssignments } from "../access-summary";
import { ResourceFeedbackGroup } from "../resource-rows";
import type { HubTeam, TeamResources } from "./types";
import { useTeamAccess } from "./use-people-resources";

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
  const memberNameByUserId = memberNamesByUserId(resources.members.data?.members ?? []);
  if (!resources.canManageResources) {
    return <TeamAdminAccess team={team} memberNameByUserId={memberNameByUserId} />;
  }
  const assignments = subjectAssignments(
    resources.assignments.data?.assignments ?? [],
    "team",
    team.id,
  );
  return (
    <SettingsSection title="Access">
      <AccessSummary
        entries={assignments.map((assignment) => ({ assignment, source: team.name }))}
        resources={resources.catalog.data?.resources ?? []}
        accessLevels={resources.catalog.data?.accessLevels ?? EMPTY_ACCESS_LEVELS}
        emptyMessage="No resource access granted"
        memberNameByUserId={memberNameByUserId}
      />
      <Button variant="outline" disabled={pending} onPress={manageAccess}>
        Manage access
      </Button>
    </SettingsSection>
  );
}

function TeamAdminAccess({
  team,
  memberNameByUserId,
}: {
  team: HubTeam;
  memberNameByUserId: ReadonlyMap<string, string>;
}) {
  const access = useTeamAccess(team.id);
  return (
    <SettingsSection title="Access">
      <ResourceFeedbackGroup queries={[access]} />
      {access.data === undefined ? null : (
        <AccessSummary
          entries={access.data.assignments.map((assignment) => ({
            assignment,
            source: team.name,
          }))}
          resources={access.data.resources}
          accessLevels={access.data.accessLevels}
          emptyMessage="No resource access granted"
          memberNameByUserId={memberNameByUserId}
        />
      )}
      <Text style={settingsStyles.rowHint}>
        Team Admins manage who is in the Team. An Organization Admin changes what the Team can use.
      </Text>
    </SettingsSection>
  );
}
