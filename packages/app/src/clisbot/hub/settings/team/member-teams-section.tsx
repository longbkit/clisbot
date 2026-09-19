import { useCallback } from "react";
import { Text, View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { EmptyRow } from "../resource-rows";
import type { HubMember, HubTeam } from "./types";
import type { TeamActions } from "./use-team-actions";

/** Every Team, with whether this Member is in it; managers toggle membership row by row. */
export function MemberTeamsSection({
  member,
  teams,
  actions,
  canManage,
}: {
  member: HubMember;
  teams: readonly HubTeam[];
  actions: TeamActions;
  canManage: boolean;
}) {
  return (
    <SettingsSection title="Teams">
      <View style={settingsStyles.card}>
        {teams.length === 0 ? (
          <EmptyRow message="No Teams yet" />
        ) : (
          teams.map((team, index) => (
            <MembershipRow
              key={team.id}
              team={team}
              userId={member.userId}
              bordered={index > 0}
              canManage={canManage}
              actions={actions}
            />
          ))
        )}
      </View>
    </SettingsSection>
  );
}

function MembershipRow({
  team,
  userId,
  bordered,
  canManage,
  actions,
}: {
  team: HubTeam;
  userId: string;
  bordered: boolean;
  canManage: boolean;
  actions: TeamActions;
}) {
  const included = team.userIds.includes(userId);
  const { addTeamMembers, removeTeamMember, pending } = actions;
  const toggle = useCallback(() => {
    if (included) removeTeamMember(team.id, userId);
    else void addTeamMembers(team.id, [userId]);
  }, [addTeamMembers, included, removeTeamMember, team.id, userId]);
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{team.name}</Text>
        <Text style={settingsStyles.rowHint}>
          {included ? "Member of this Team" : "Not a member"}
        </Text>
      </View>
      {canManage ? (
        <Button
          size="xs"
          variant={included ? "ghost" : "outline"}
          disabled={pending}
          onPress={toggle}
        >
          {included ? "Remove" : "Add"}
        </Button>
      ) : null}
    </View>
  );
}
