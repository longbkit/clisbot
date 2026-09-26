import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";
import { countLabel } from "../labels";
import { MultiSelectField, type MultiSelection } from "../multi-select-field";
import { canManageTeamMembership, memberTeamChanges } from "./team-membership";
import type { HubMember, HubTeam, PeopleAuthority, TeamResources } from "./types";
import { useCreateTeamChoice } from "./use-create-team-choice";
import type { TeamActions } from "./use-team-actions";

const NO_TEAMS: HubTeam[] = [];

/** The Teams dialog for the Member picked from a Members row, or nothing. */
export function MemberTeamsModal({
  member,
  resources,
  actions,
  close,
}: {
  member: HubMember | null;
  resources: TeamResources;
  actions: TeamActions;
  close(): void;
}) {
  if (member === null) return null;
  return (
    <MemberTeamsSheet
      member={member}
      teams={resources.teams.data?.teams ?? NO_TEAMS}
      authority={resources.authority}
      canCreate={resources.canManageResources}
      actions={actions}
      close={close}
    />
  );
}

/**
 * Every Team a Member is in, from a Members row, whether they are in none or several: pick
 * Teams to join, drop one to leave it, save once. Only the Teams the viewer manages are
 * offered; the Member's other Teams are named so the list does not look incomplete.
 */
function MemberTeamsSheet({
  member,
  teams,
  authority,
  canCreate,
  actions,
  close,
}: {
  member: HubMember;
  teams: readonly HubTeam[];
  authority: PeopleAuthority;
  /** Organization Admins may type a new Team name and create it from the picker. */
  canCreate: boolean;
  actions: TeamActions;
  close(): void;
}) {
  const managed = useMemo(
    () => teams.filter(({ id }) => canManageTeamMembership(authority, id)),
    [authority, teams],
  );
  const current = useMemo(
    () => managed.filter(({ userIds }) => userIds.includes(member.userId)).map(({ id }) => id),
    [managed, member.userId],
  );
  const [chosen, setChosen] = useState<readonly string[]>(current);
  const choose = useCallback((value: MultiSelection) => setChosen(value === "*" ? [] : value), []);
  const add = useCallback((teamId: string) => setChosen((ids) => [...ids, teamId]), []);
  const create = useCreateTeamChoice(actions, canCreate, add);
  const changes = useMemo(() => memberTeamChanges(current, chosen), [chosen, current]);
  const changed = changes.add.length + changes.remove.length > 0;
  const { setMemberTeams, pending } = actions;
  const save = useCallback(async () => {
    if (await setMemberTeams(member.userId, changes)) close();
  }, [changes, close, member.userId, setMemberTeams]);
  const press = useCallback(() => void save(), [save]);
  const options = useMemo(() => teamOptions(managed), [managed]);
  const header = useMemo(() => ({ title: `Teams for ${member.name}` }), [member.name]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="secondary" disabled={pending} onPress={close}>
          Cancel
        </Button>
        <Button disabled={!changed || pending} loading={pending} onPress={press}>
          Save
        </Button>
      </View>
    ),
    [changed, close, pending, press],
  );
  const others = teams.filter(
    ({ id, userIds }) => userIds.includes(member.userId) && !managed.some((team) => team.id === id),
  );
  return (
    <AdaptiveModalSheet
      visible
      header={header}
      onClose={close}
      footer={footer}
      desktopMaxWidth={520}
    >
      <View style={styles.body}>
        <MultiSelectField
          label="Teams"
          hint={teamsHint(managed.length, canCreate, changes)}
          options={options}
          value={chosen}
          onChange={choose}
          disabled={pending || (managed.length === 0 && !canCreate)}
          placeholder={canCreate ? "Choose or create Teams" : "Choose Teams"}
          searchPlaceholder={canCreate ? "Team name, or a new one" : "Team name"}
          {...(create === undefined ? {} : { create })}
        />
        {others.length === 0 ? null : (
          <Text style={settingsStyles.rowHint}>
            {`Also in ${others.map(({ name }) => name).join(", ")}, managed by their Team Admins.`}
          </Text>
        )}
        {actions.mutationError ? <Alert variant="error" title={actions.mutationError} /> : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function teamOptions(teams: readonly HubTeam[]): SelectFieldOption<string>[] {
  return teams.map((team) => ({
    id: team.id,
    value: team.id,
    label: team.name,
    description: countLabel(team.userIds.length, "Member"),
  }));
}

function teamsHint(
  managed: number,
  canCreate: boolean,
  { add, remove }: { add: string[]; remove: string[] },
): string {
  if (managed === 0) return canCreate ? "Type a name to create a Team." : "Create a Team first.";
  const parts = [
    ...(add.length > 0 ? [`joins ${countLabel(add.length, "Team")}`] : []),
    ...(remove.length > 0 ? [`leaves ${countLabel(remove.length, "Team")}`] : []),
  ];
  if (parts.length === 0) {
    const pick = canCreate ? "Pick Teams or type a new name" : "Pick Teams";
    return `${pick}; remove one to take them out of it.`;
  }
  return `On save: ${parts.join(", ")}.`;
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[3] },
  footer: { flex: 1, flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
}));
