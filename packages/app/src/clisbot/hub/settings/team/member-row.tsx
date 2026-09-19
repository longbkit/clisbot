import React, { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { buttonControlHeight } from "@/components/ui/control-geometry";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { MemberChatCell } from "./member-chat-cell";
import { memberTeamNames, type MemberDirectoryRow } from "./member-directory";
import { MemberRoleSelect } from "./member-role-select";
import { memberRemoveLockReason, type OrganizationRole } from "./member-role";
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
  const removeLocked = memberRemoveLockReason(member, members, capabilities) !== null;
  const actions = useMemo(
    () => [
      { label: "View", onSelect: view },
      { label: "Remove", onSelect: remove, destructive: true, disabled: removeLocked },
    ],
    [remove, removeLocked, view],
  );
  const canManageMembers = capabilities?.manageMembers === true;
  const compact = useIsCompactFormFactor();
  const teamsCell = (
    <View style={styles.cellLine}>
      <Text style={settingsStyles.rowHint}>{memberTeamNames(member, teams)}</Text>
      {canInvite && needsTeam(member, teams) ? (
        <Button size="xs" variant="ghost" disabled={pending} onPress={addToTeam}>
          Add to a Team
        </Button>
      ) : null}
    </View>
  );
  const chatCell =
    chat === undefined ? null : (
      <MemberChatCell links={chat} canLink={canLinkChat} pending={pending} onLink={view} />
    );
  const trailing = (
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
  );
  const identity = (
    <>
      <Text style={settingsStyles.rowTitle}>{member.name}</Text>
      <Text style={settingsStyles.rowHint}>{member.email}</Text>
    </>
  );
  const border = bordered ? settingsStyles.rowBorder : null;
  // A phone has no room for columns: the row becomes a card, each value labelled.
  if (compact)
    return (
      <View style={[settingsStyles.row, border, styles.stackedRow]}>
        <View>{identity}</View>
        <LabelledCell label="Teams">{teamsCell}</LabelledCell>
        {chatCell === null ? null : <LabelledCell label="Chat">{chatCell}</LabelledCell>}
        {trailing}
      </View>
    );
  return (
    <View style={[settingsStyles.row, border, styles.tableRow]}>
      <View style={styles.memberColumn}>{identity}</View>
      <View style={styles.teamsColumn}>{teamsCell}</View>
      {chat === undefined ? null : <View style={styles.chatColumn}>{chatCell}</View>}
      {trailing}
    </View>
  );
}

/**
 * The column names, once, over the rows (wide screens only). Uses the rows'
 * column styles, so the headings sit over their values.
 */
export function MemberTableHeader({ chat, role }: { chat: boolean; role: boolean }) {
  if (useIsCompactFormFactor()) return null;
  return (
    <View style={[settingsStyles.row, styles.tableRow, styles.header]}>
      <Text style={[styles.cellLabel, styles.memberColumn]}>Member</Text>
      <Text style={[styles.cellLabel, styles.teamsColumn]}>Teams</Text>
      {chat ? <Text style={[styles.cellLabel, styles.chatColumn]}>Chat</Text> : null}
      <View style={styles.trailing}>
        {role ? <Text style={[styles.cellLabel, styles.roleHeading]}>Role</Text> : null}
        <View style={styles.menuSpace} />
      </View>
    </View>
  );
}

function LabelledCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.stackedCell}>
      <Text style={styles.cellLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  tableRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[4] },
  header: { paddingVertical: theme.spacing[2] },
  memberColumn: { flex: 3, minWidth: 0 },
  teamsColumn: { flex: 2, minWidth: 0 },
  chatColumn: { flex: 3, minWidth: 0 },
  // Every line is a button tall, with or without its button, so text sits level.
  cellLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    minHeight: buttonControlHeight.xs,
  },
  cellLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  trailing: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[2] },
  // The Role column is the dropdown's fixed width; the menu's space keeps it aligned.
  roleHeading: { width: 180 },
  menuSpace: { width: buttonControlHeight.sm },
  stackedRow: { flexDirection: "column", alignItems: "stretch", gap: theme.spacing[3] },
  stackedCell: { gap: theme.spacing[0.5] },
}));
