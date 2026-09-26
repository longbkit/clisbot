import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { subjectAssignments } from "../access-catalog";
import { countLabel } from "../labels";
import { tableStyles } from "../table-styles";
import { MemberTeamsModal } from "./member-teams-modal";
import { RowActionsMenu } from "./row-actions-menu";
import { teamAccessLine } from "./team-directory";
import { canManageTeamMembership, managesAnyTeam } from "./team-membership";
import type { HubMember, HubTeam, TeamResources } from "./types";
import type { TeamActions } from "./use-team-actions";

/**
 * The Teams this Member is in, each with what the Team grants, so the Member's access through
 * Teams reads here. Edit Teams opens the same dialog as the Members row: join several Teams,
 * leave some, or create one. Leaving one Team is also in its row's … menu.
 */
export function MemberTeamsSection({
  member,
  teams,
  resources,
  actions,
}: {
  member: HubMember;
  teams: readonly HubTeam[];
  resources: TeamResources;
  actions: TeamActions;
}) {
  const [editing, setEditing] = useState(false);
  const open = useCallback(() => {
    actions.setMutationError(null);
    setEditing(true);
  }, [actions]);
  const close = useCallback(() => setEditing(false), []);
  const joined = teams.filter((team) => team.userIds.includes(member.userId));
  const canEdit = managesAnyTeam(resources.authority);
  const editButton = useMemo(
    () =>
      canEdit ? (
        <Button size="sm" variant="outline" disabled={actions.pending} onPress={open}>
          {joined.length === 0 ? "Add to a Team" : "Edit Teams"}
        </Button>
      ) : null,
    [actions.pending, canEdit, joined.length, open],
  );
  // Only readers of access assignments see what each Team grants.
  const assignments = resources.canManageResources
    ? resources.assignments.data?.assignments
    : undefined;
  return (
    <SettingsSection title="Teams" trailing={editButton}>
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
              access={
                assignments === undefined
                  ? undefined
                  : teamAccessLine(subjectAssignments(assignments, "team", team.id))
              }
              canManage={canManageTeamMembership(resources.authority, team.id)}
              actions={actions}
            />
          ))
        )}
      </View>
      <MemberTeamsModal
        member={editing ? member : null}
        resources={resources}
        actions={actions}
        close={close}
      />
    </SettingsSection>
  );
}

function JoinedTeamRow({
  team,
  member,
  bordered,
  access,
  canManage,
  actions,
}: {
  team: HubTeam;
  member: HubMember;
  bordered: boolean;
  /** "2 Hosts · 1 Project" or "No access"; undefined when the viewer cannot read grants. */
  access: string | undefined;
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
  const members = countLabel(team.userIds.length, "Member");
  return (
    <View
      style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null, tableStyles.body]}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{team.name}</Text>
        <Text style={settingsStyles.rowHint}>
          {access === undefined ? members : `${members} · ${access}`}
        </Text>
      </View>
      {canManage ? (
        <RowActionsMenu label={`Actions for ${team.name}`} actions={items} disabled={pending} />
      ) : null}
    </View>
  );
}
