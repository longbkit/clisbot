import { useCallback, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { AccessSummary, EMPTY_ACCESS_LEVELS, subjectAssignments } from "../access-summary";
import { TeamMemberRows } from "./team-member-rows";
import { TeamSettingsTab } from "./team-settings-tab";
import type { HubAccount, HubTeam, TeamResources } from "./types";
import { useTeamAdminAction } from "./use-people-actions";
import type { TeamActions } from "./use-team-actions";

type TeamView = "members" | "access" | "settings";
const TEAM_VIEWS: SegmentedControlOption<TeamView>[] = [
  { value: "members", label: "Members" },
  { value: "access", label: "Access" },
  { value: "settings", label: "Settings" },
];

export function SelectedTeamDetail({
  hub,
  team,
  resources,
  actions,
  back,
  manageAccess,
  addPeople,
  canInvite,
}: {
  hub: HubAccount;
  team: HubTeam;
  resources: TeamResources;
  actions: TeamActions;
  back(): void;
  manageAccess(): void;
  addPeople(team: HubTeam): void;
  /** Invitations need both Team management and Member management. */
  canInvite: boolean;
}) {
  const [view, setView] = useState<TeamView>("members");
  const { pending, mutationError } = actions;
  const canManage = resources.canManageResources;
  const teamAdmin = useTeamAdminAction(hub, resources, actions.run);
  const removeMember = useCallback(
    (userId: string) => actions.removeTeamMember(team.id, userId),
    [actions, team.id],
  );
  const invite = useCallback(() => addPeople(team), [addPeople, team]);
  const assignments = subjectAssignments(
    resources.assignments.data?.assignments ?? [],
    "team",
    team.id,
  );
  return (
    <View>
      <SettingsSection title={team.name}>
        <View style={styles.actions}>
          <Button size="xs" variant="outline" disabled={pending} onPress={back}>
            Back to People
          </Button>
          {canInvite ? (
            <Button size="xs" variant="outline" disabled={pending} onPress={invite}>
              Add people
            </Button>
          ) : null}
        </View>
        {mutationError ? <Alert variant="error" title={mutationError} /> : null}
        {canManage ? (
          <SegmentedControl options={TEAM_VIEWS} value={view} onValueChange={setView} size="sm" />
        ) : null}
      </SettingsSection>
      {view === "members" ? (
        <SettingsSection title="Members">
          <TeamMemberRows
            team={team}
            resources={resources}
            pending={pending}
            canManage={canManage}
            teamAdmin={teamAdmin}
            removeMember={removeMember}
          />
        </SettingsSection>
      ) : null}
      {view === "access" && canManage ? (
        <SettingsSection title="Access">
          <AccessSummary
            entries={assignments.map((assignment) => ({ assignment, source: team.name }))}
            resources={resources.catalog.data?.resources ?? []}
            accessLevels={resources.catalog.data?.accessLevels ?? EMPTY_ACCESS_LEVELS}
            emptyMessage="No resource access granted"
          />
          <Button variant="outline" disabled={pending} onPress={manageAccess}>
            Manage access
          </Button>
        </SettingsSection>
      ) : null}
      {view === "settings" && canManage ? (
        <TeamSettingsTab team={team} actions={actions} onDeleted={back} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
