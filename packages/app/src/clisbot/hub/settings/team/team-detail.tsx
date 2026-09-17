import { useCallback, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { settingsStyles } from "@/styles/settings";
import { AccessSummary, EMPTY_ACCESS_LEVELS, subjectAssignments } from "../access-summary";
import { countLabel } from "../labels";
import { InfoRow } from "../resource-rows";
import { TeamMembersSection } from "../team-members-section";
import type { HubTeam, TeamResources } from "./types";
import type { TeamActions } from "./use-team-actions";

export function SelectedTeamDetail({
  team,
  resources,
  actions,
  back,
  manageAccess,
  addPeople,
  canManage,
  canInvite,
}: {
  team: HubTeam;
  resources: TeamResources;
  actions: TeamActions;
  back(): void;
  manageAccess(): void;
  addPeople(teamIds: string[]): void;
  canManage: boolean;
  /** Invitations need both Team management and Member management. */
  canInvite: boolean;
}) {
  const { pending, mutationError } = actions;
  const assignments = subjectAssignments(
    resources.assignments.data?.assignments ?? [],
    "team",
    team.id,
  );
  const addMembers = useCallback(
    (userIds: string[]) => actions.addTeamMembers(team.id, userIds),
    [actions, team.id],
  );
  const removeMember = useCallback(
    (userId: string) => actions.removeTeamMember(team.id, userId),
    [actions, team.id],
  );
  const remove = useCallback(async () => {
    if (await actions.removeTeam(team.id, team.name)) back();
  }, [actions, back, team.id, team.name]);
  const removeTeam = useCallback(() => void remove(), [remove]);
  const invite = useCallback(() => addPeople([team.id]), [addPeople, team.id]);
  return (
    <View>
      <SettingsSection title={team.name}>
        <View style={styles.actions}>
          <Button size="xs" variant="outline" disabled={pending} onPress={back}>
            Back to Teams
          </Button>
          {canInvite ? (
            <Button size="xs" variant="outline" disabled={pending} onPress={invite}>
              Add people to this Team
            </Button>
          ) : null}
        </View>
        {mutationError ? <Alert variant="error" title={mutationError} /> : null}
        <View style={settingsStyles.card}>
          <InfoRow
            title={countLabel(team.userIds.length, "Member")}
            hint={
              canManage ? countLabel(assignments.length, "access assignment") : "Team membership"
            }
          />
        </View>
        {canManage ? <RenameTeam team={team} actions={actions} /> : null}
      </SettingsSection>
      <TeamMembersSection
        teamUserIds={team.userIds}
        members={resources.members.data?.members ?? []}
        pending={pending}
        canManage={canManage}
        addMembers={addMembers}
        removeMember={removeMember}
      />
      {canManage ? (
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
      {canManage ? (
        <SettingsSection title="Danger zone">
          <Button variant="destructive" disabled={pending} onPress={removeTeam}>
            Delete Team
          </Button>
        </SettingsSection>
      ) : null}
    </View>
  );
}

function RenameTeam({ team, actions }: { team: HubTeam; actions: TeamActions }) {
  const [name, setName] = useState(team.name);
  const rename = useCallback(
    () => void actions.renameTeam(team.id, name.trim()),
    [actions, name, team.id],
  );
  return (
    <View style={[settingsStyles.card, styles.form]}>
      <Field label="Team name">
        <FormTextInput
          key={team.id}
          initialValue={team.name}
          onChangeText={setName}
          editable={!actions.pending}
        />
      </Field>
      <Button
        variant="outline"
        disabled={actions.pending || name.trim().length === 0 || name.trim() === team.name}
        onPress={rename}
      >
        Rename Team
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
