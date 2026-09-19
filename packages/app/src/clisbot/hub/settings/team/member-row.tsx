import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { MemberChatCell } from "./member-chat-cell";
import { memberTeamNames, type MemberDirectoryRow } from "./member-directory";
import { MemberRoleSelect } from "./member-role-select";
import type { OrganizationRole } from "./member-role";
import { RowActionsMenu } from "./row-actions-menu";
import { needsTeam } from "./team-membership";
import type { HubCapabilities, HubMember, TeamSelection } from "./types";

export interface MemberRowHandlers {
  select(value: TeamSelection): void;
  setRole(member: HubMember, role: OrganizationRole): Promise<void>;
  remove(member: HubMember): void;
  /** Opens Invite people with this Member picked, from a "No Team" row. */
  addToTeam(member: HubMember): void;
}

export function MemberRow({
  row,
  members,
  capabilities,
  canLinkChat,
  canInvite,
  pending,
  bordered,
  handlers,
}: {
  row: MemberDirectoryRow;
  members: readonly HubMember[];
  capabilities: HubCapabilities | undefined;
  canLinkChat: boolean;
  canInvite: boolean;
  pending: boolean;
  bordered: boolean;
  handlers: MemberRowHandlers;
}) {
  const { member, teams, chat } = row;
  const view = useCallback(
    () => handlers.select({ kind: "member", id: member.id }),
    [handlers, member.id],
  );
  const remove = useCallback(() => handlers.remove(member), [handlers, member]);
  const addToTeam = useCallback(() => handlers.addToTeam(member), [handlers, member]);
  const actions = useMemo(
    () => [
      { label: "View", onSelect: view },
      {
        label: "Remove",
        onSelect: remove,
        destructive: true,
        disabled: capabilities?.manageMembers !== true,
      },
    ],
    [capabilities?.manageMembers, remove, view],
  );
  const canManageMembers = capabilities?.manageMembers === true;
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{member.name}</Text>
        <Text style={settingsStyles.rowHint}>{member.email}</Text>
        <View style={styles.cells}>
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>Teams</Text>
            <View style={styles.cellLine}>
              <Text style={settingsStyles.rowHint}>{memberTeamNames(member, teams)}</Text>
              {canInvite && needsTeam(member, teams) ? (
                <Button size="xs" variant="ghost" disabled={pending} onPress={addToTeam}>
                  Add to a Team
                </Button>
              ) : null}
            </View>
          </View>
          {chat === undefined ? null : (
            <View style={styles.cell}>
              <Text style={styles.cellLabel}>Chat</Text>
              <MemberChatCell links={chat} canLink={canLinkChat} pending={pending} onLink={view} />
            </View>
          )}
        </View>
      </View>
      <View style={styles.trailing}>
        {canManageMembers ? (
          <MemberRoleSelect
            member={member}
            members={members}
            capabilities={capabilities}
            pending={pending}
            setRole={handlers.setRole}
          />
        ) : null}
        <RowActionsMenu label={`Actions for ${member.name}`} actions={actions} disabled={pending} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  cells: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[4],
    marginTop: theme.spacing[1],
  },
  cell: { gap: theme.spacing[0.5], minWidth: 160 },
  cellLine: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  cellLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  trailing: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
}));
