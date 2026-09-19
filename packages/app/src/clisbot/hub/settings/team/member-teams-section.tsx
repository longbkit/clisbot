import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";
import { countLabel } from "../labels";
import { tableStyles } from "../table-styles";
import { RowActionsMenu } from "./row-actions-menu";
import type { HubMember, HubTeam } from "./types";
import type { TeamActions } from "./use-team-actions";

/**
 * The Teams this Member is in. With dozens of Teams, listing every one to toggle does not scale:
 * Add to Team… picks one of the Teams you manage, and leaving a Team is in its row's … menu.
 */
export function MemberTeamsSection({
  member,
  teams,
  actions,
  canManage,
}: {
  member: HubMember;
  teams: readonly HubTeam[];
  actions: TeamActions;
  canManage(teamId: string): boolean;
}) {
  const [adding, setAdding] = useState(false);
  const open = useCallback(() => setAdding(true), []);
  const close = useCallback(() => setAdding(false), []);
  const joined = teams.filter((team) => team.userIds.includes(member.userId));
  const joinable = teams.filter(
    (team) => !team.userIds.includes(member.userId) && canManage(team.id),
  );
  const addButton = useMemo(
    () =>
      joinable.length > 0 ? (
        <Button size="sm" variant="outline" disabled={actions.pending} onPress={open}>
          Add to Team…
        </Button>
      ) : null,
    [actions.pending, joinable.length, open],
  );
  return (
    <SettingsSection title="Teams" trailing={addButton}>
      <View style={settingsStyles.card}>
        {joined.length === 0 ? (
          <View style={[settingsStyles.row, tableStyles.body]}>
            <Text style={settingsStyles.rowHint}>Not in any Team yet.</Text>
          </View>
        ) : (
          joined.map((team, index) => (
            <JoinedTeamRow
              key={team.id}
              team={team}
              member={member}
              bordered={index > 0}
              canManage={canManage(team.id)}
              actions={actions}
            />
          ))
        )}
      </View>
      {adding ? (
        <AddToTeamSheet member={member} teams={joinable} actions={actions} close={close} />
      ) : null}
    </SettingsSection>
  );
}

function JoinedTeamRow({
  team,
  member,
  bordered,
  canManage,
  actions,
}: {
  team: HubTeam;
  member: HubMember;
  bordered: boolean;
  canManage: boolean;
  actions: TeamActions;
}) {
  const { removeTeamMember, pending } = actions;
  const items = useMemo(
    () => [
      {
        label: "Remove from Team",
        destructive: true,
        disabled: pending,
        onSelect: () => removeTeamMember(team.id, member.userId),
      },
    ],
    [member.userId, pending, removeTeamMember, team.id],
  );
  return (
    <View
      style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null, tableStyles.body]}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{team.name}</Text>
        <Text style={settingsStyles.rowHint}>{countLabel(team.userIds.length, "Member")}</Text>
      </View>
      {canManage ? (
        <RowActionsMenu label={`Actions for ${team.name}`} actions={items} disabled={pending} />
      ) : null}
    </View>
  );
}

function AddToTeamSheet({
  member,
  teams,
  actions,
  close,
}: {
  member: HubMember;
  teams: readonly HubTeam[];
  actions: TeamActions;
  close(): void;
}) {
  const [teamId, setTeamId] = useState<string | null>(null);
  const options = useMemo(
    () => teams.map((team) => ({ id: team.id, value: team.id, label: team.name })),
    [teams],
  );
  const display = useMemo(() => {
    const label = teams.find(({ id }) => id === teamId)?.name;
    return label === undefined ? null : { label };
  }, [teamId, teams]);
  const add = useCallback(async () => {
    if (teamId === null) return;
    // A refusal keeps the sheet open; the page shows why.
    const refused = await actions.addTeamMembers(teamId, [member.userId]);
    if (refused.length === 0) close();
  }, [actions, close, member.userId, teamId]);
  const press = useCallback(() => void add(), [add]);
  const header = useMemo(() => ({ title: `Add ${member.name} to a Team` }), [member.name]);
  return (
    <AdaptiveModalSheet visible header={header} onClose={close} desktopMaxWidth={480}>
      <View style={styles.sheet}>
        {actions.mutationError ? <Alert variant="error" title={actions.mutationError} /> : null}
        <SelectField
          label="Team"
          value={teamId}
          selectedDisplay={display}
          options={options}
          onChange={setTeamId}
          placeholder="Choose a Team"
          emptyText="No other Team you manage."
          searchable
          searchPlaceholder="Search Teams"
        />
        <View style={styles.actions}>
          <Button disabled={teamId === null || actions.pending} onPress={press}>
            Add to Team
          </Button>
          <Button variant="ghost" onPress={close}>
            Cancel
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  sheet: { gap: theme.spacing[4] },
  actions: { flexDirection: "row", gap: theme.spacing[2] },
}));
