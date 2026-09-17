import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { SearchField } from "@/components/ui/search-field";
import { settingsStyles } from "@/styles/settings";
import { invitationTeams } from "../../contracts";
import { subjectAssignments } from "../access-summary";
import { countLabel } from "../labels";
import { EmptyRow, ResourceFeedbackGroup } from "../resource-rows";
import { matchesSearch } from "../search-text";
import { SummaryStats, type SummaryStat } from "../summary-stats";
import { canAddPeopleToTeams, needsTeam } from "./team-membership";
import { PendingInvitations } from "./pending-invitations";
import { TeamAdditionForm, type TeamAdditionDraftState } from "./team-addition-form";
import type {
  HubAccount,
  HubManagedInvitation,
  HubMember,
  HubTeam,
  TeamResources,
  TeamSelection,
} from "./types";
import type { TeamActions } from "./use-team-actions";

/** Above this many Teams the list gets a search box. */
const TEAM_SEARCH_THRESHOLD = 6;

function teamStats(
  teams: readonly HubTeam[],
  members: readonly HubMember[],
  invitations: readonly HubManagedInvitation[] | undefined,
): SummaryStat[] {
  const inTeam = new Set(teams.flatMap(({ userIds }) => userIds));
  return [
    { label: "Teams", value: teams.length },
    {
      label: "Members in a Team",
      value: members.filter(({ userId }) => inTeam.has(userId)).length,
    },
    {
      label: "Without a Team",
      value: members.filter((member) => needsTeam(member, teams)).length,
      hint: "Owners excluded",
    },
    ...(invitations === undefined
      ? []
      : [{ label: "Pending invitations", value: invitations.length }]),
  ];
}

export function TeamsTab({
  hub,
  resources,
  actions,
  draft,
  select,
}: {
  hub: HubAccount;
  resources: TeamResources;
  actions: TeamActions;
  draft: TeamAdditionDraftState;
  select(value: TeamSelection): void;
}) {
  const capabilities = hub.signedIn?.capabilities;
  const canAddPeople = canAddPeopleToTeams(capabilities);
  const invitations =
    capabilities?.manageMembers === true ? (hub.signedIn?.team?.invitations ?? []) : undefined;
  const teams = resources.teams.data?.teams ?? [];
  return (
    <View>
      <SettingsSection title="Overview">
        <ResourceFeedbackGroup queries={[resources.teams, resources.members]} />
        <SummaryStats
          stats={teamStats(teams, resources.members.data?.members ?? [], invitations)}
        />
        {actions.mutationError ? <Alert variant="error" title={actions.mutationError} /> : null}
      </SettingsSection>
      {canAddPeople ? (
        <SettingsSection
          title="Add people to Teams"
          info="Existing Members join the chosen Teams now. New emails get one invitation that joins every chosen Team when the person signs in."
        >
          <TeamAdditionForm hub={hub} resources={resources} actions={actions} draftState={draft} />
        </SettingsSection>
      ) : null}
      <TeamDirectory
        teams={teams}
        resources={resources}
        actions={actions}
        invitations={invitations ?? []}
        canManage={resources.canManageResources}
        select={select}
      />
      {invitations === undefined ? null : (
        <PendingInvitations hub={hub} invitations={invitations} actions={actions} />
      )}
    </View>
  );
}

function TeamDirectory({
  teams,
  resources,
  actions,
  invitations,
  canManage,
  select,
}: {
  teams: readonly HubTeam[];
  resources: TeamResources;
  actions: TeamActions;
  invitations: readonly HubManagedInvitation[];
  canManage: boolean;
  select(value: TeamSelection): void;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () => teams.filter((team) => matchesSearch(query, [team.name])),
    [query, teams],
  );
  const assignments = resources.assignments.data?.assignments ?? [];
  return (
    <SettingsSection title="Teams">
      {canManage ? (
        <ResourceFeedbackGroup queries={[resources.assignments, resources.catalog]} />
      ) : null}
      {teams.length > TEAM_SEARCH_THRESHOLD ? (
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search Teams"
          clearAccessibilityLabel="Clear Team search"
        />
      ) : null}
      <View style={settingsStyles.card}>
        {visible.length === 0 ? (
          <EmptyRow
            message={
              teams.length === 0
                ? "No Teams. The owner already has full access."
                : "No Teams match."
            }
          />
        ) : (
          visible.map((team, index) => (
            <TeamDirectoryRow
              key={team.id}
              team={team}
              assignmentCount={
                canManage ? subjectAssignments(assignments, "team", team.id).length : undefined
              }
              invitationCount={
                invitations.filter((invitation) =>
                  invitationTeams(invitation).some(({ id }) => id === team.id),
                ).length
              }
              bordered={index > 0}
              select={select}
            />
          ))
        )}
      </View>
      {canManage ? <CreateTeam teamCount={teams.length} actions={actions} /> : null}
    </SettingsSection>
  );
}

function TeamDirectoryRow({
  team,
  assignmentCount,
  invitationCount,
  bordered,
  select,
}: {
  team: HubTeam;
  /** Undefined when the viewer cannot read access assignments. */
  assignmentCount: number | undefined;
  invitationCount: number;
  bordered: boolean;
  select(value: TeamSelection): void;
}) {
  const view = useCallback(() => select({ kind: "team", id: team.id }), [select, team.id]);
  const details = [
    countLabel(team.userIds.length, "Member"),
    ...(assignmentCount === undefined ? [] : [countLabel(assignmentCount, "access assignment")]),
    ...(invitationCount > 0 ? [countLabel(invitationCount, "pending invitation")] : []),
  ];
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{team.name}</Text>
        <Text style={settingsStyles.rowHint}>{details.join(" · ")}</Text>
      </View>
      <Button size="xs" variant="ghost" onPress={view} accessibilityLabel={`View ${team.name}`}>
        View
      </Button>
    </View>
  );
}

function CreateTeam({ teamCount, actions }: { teamCount: number; actions: TeamActions }) {
  const [name, setName] = useState("");
  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length > 0 && (await actions.createTeam(trimmed))) setName("");
  }, [actions, name]);
  const onCreate = useCallback(() => void create(), [create]);
  return (
    <View style={[settingsStyles.card, styles.create]}>
      <View style={styles.createInput}>
        <FormTextInput
          initialValue=""
          resetKey={teamCount}
          onChangeText={setName}
          placeholder="New Team name"
          accessibilityLabel="Team name"
          editable={!actions.pending}
        />
      </View>
      <Button disabled={actions.pending || name.trim().length === 0} onPress={onCreate}>
        Create Team
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  create: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  createInput: {
    flexGrow: 1,
    flexBasis: 200,
  },
}));
