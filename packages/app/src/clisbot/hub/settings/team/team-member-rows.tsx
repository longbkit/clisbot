import { useCallback, useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";
import { EmptyRow } from "../resource-rows";
import { roleLabel } from "./member-role";
import { teamRoleOf, type TeamRole } from "./team-admin";
import type { HubMember, HubTeam, TeamResources } from "./types";
import type { useTeamAdminAction } from "./use-people-actions";
import { withEmail } from "@/clisbot/hub/account-email";

function teamRoleOptions(t: TFunction): SelectFieldOption<TeamRole>[] {
  return [
    { id: "member", value: "member", label: roleLabel("member", t) },
    {
      id: "admin",
      value: "admin",
      label: roleLabel("admin", t),
      description: t("hub.team.teamDetail.roles.adminDescription"),
    },
  ];
}

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
  const { t } = useTranslation();
  const members = (resources.members.data?.members ?? []).filter(({ userId }) =>
    team.userIds.includes(userId),
  );
  const assignments = resources.assignments.data?.assignments ?? [];
  return (
    <View style={settingsStyles.card}>
      {members.length === 0 ? (
        <EmptyRow message={t("hub.team.teamDetail.noMembers")} />
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
  const { t } = useTranslation();
  const remove = useCallback(() => removeMember(member.userId), [member.userId, removeMember]);
  const display = useMemo(() => ({ label: roleLabel(role, t) }), [role, t]);
  const options = useMemo(() => teamRoleOptions(t), [t]);
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
        <Text style={settingsStyles.rowHint}>
          {withEmail(roleLabel(member.role, t), member.email)}
        </Text>
      </View>
      {canManage ? (
        <View style={styles.trailing}>
          <SelectField
            size="sm"
            label={t("hub.team.teamDetail.roles.label")}
            value={role}
            selectedDisplay={display}
            options={options}
            onChange={change}
            placeholder={t("hub.team.teamDetail.roles.label")}
            emptyText={t("hub.team.teamDetail.roles.empty")}
            title={t("hub.team.teamDetail.roles.title", { name: member.name })}
            disabled={pending || teamAdmin.unsupported}
            hint={teamAdmin.unsupported ? t("hub.team.teamDetail.roles.needsNewerHub") : undefined}
          />
          <Button size="xs" variant="ghost" disabled={pending} onPress={remove}>
            {t("hub.team.actions.remove")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  trailing: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
}));
