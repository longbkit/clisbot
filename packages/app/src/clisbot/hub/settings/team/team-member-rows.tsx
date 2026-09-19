import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";
import { capitalizeLabel } from "../labels";
import { EmptyRow } from "../resource-rows";
import { teamRoleOf, type TeamRole } from "./team-admin";
import type { HubMember, HubTeam, TeamResources } from "./types";
import type { useTeamAdminAction } from "./use-people-actions";

const TEAM_ROLE_OPTIONS: SelectFieldOption<TeamRole>[] = [
  { id: "member", value: "member", label: "Member" },
  { id: "admin", value: "admin", label: "Admin", description: "Manages who is in the Team" },
];

/** Who is in the Team, each with their Team role. Team Admin manages membership, not the Team's grants. */
export function TeamMemberRows({
  team,
  resources,
  pending,
  canManage,
  teamAdmin,
  removeMember,
}: {
  team: HubTeam;
  resources: TeamResources;
  pending: boolean;
  canManage: boolean;
  teamAdmin: ReturnType<typeof useTeamAdminAction>;
  removeMember(userId: string): void;
}) {
  const members = (resources.members.data?.members ?? []).filter(({ userId }) =>
    team.userIds.includes(userId),
  );
  const assignments = resources.assignments.data?.assignments ?? [];
  return (
    <View style={settingsStyles.card}>
      {members.length === 0 ? (
        <EmptyRow message="No Members in this Team yet" />
      ) : (
        members.map((member, index) => (
          <TeamMemberRow
            key={member.id}
            team={team}
            member={member}
            role={teamRoleOf(assignments, team.id, member)}
            bordered={index > 0}
            pending={pending}
            canManage={canManage}
            teamAdmin={teamAdmin}
            removeMember={removeMember}
          />
        ))
      )}
    </View>
  );
}

function TeamMemberRow({
  team,
  member,
  role,
  bordered,
  pending,
  canManage,
  teamAdmin,
  removeMember,
}: {
  team: HubTeam;
  member: HubMember;
  role: TeamRole;
  bordered: boolean;
  pending: boolean;
  canManage: boolean;
  teamAdmin: ReturnType<typeof useTeamAdminAction>;
  removeMember(userId: string): void;
}) {
  const remove = useCallback(() => removeMember(member.userId), [member.userId, removeMember]);
  const display = useMemo(() => ({ label: capitalizeLabel(role) }), [role]);
  const change = useCallback(
    (next: TeamRole) => {
      if (next !== role) teamAdmin.setTeamRole(team.id, member, next);
    },
    [member, role, team.id, teamAdmin],
  );
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{member.name}</Text>
        <Text
          style={settingsStyles.rowHint}
        >{`${member.email} · ${capitalizeLabel(member.role)}`}</Text>
      </View>
      {canManage ? (
        <View style={styles.trailing}>
          <SelectField
            size="sm"
            label="Team role"
            value={role}
            selectedDisplay={display}
            options={TEAM_ROLE_OPTIONS}
            onChange={change}
            placeholder="Team role"
            emptyText="No Team roles are available."
            title={`Team role of ${member.name}`}
            disabled={pending || teamAdmin.unsupported}
            hint={teamAdmin.unsupported ? "Team Admin needs a newer Hub." : undefined}
          />
          <Button size="xs" variant="ghost" disabled={pending} onPress={remove}>
            Remove
          </Button>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  trailing: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
}));
