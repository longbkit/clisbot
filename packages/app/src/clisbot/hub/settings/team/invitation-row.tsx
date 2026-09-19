import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { invitationTeams } from "../../contracts";
import { capitalizeLabel } from "../labels";
import { invitationExpiryLabel, invitationSentLabel, invitationState } from "./invitation-status";
import { RowActionsMenu } from "./row-actions-menu";
import type { HubManagedInvitation } from "./types";
import type { useInvitationActions } from "./use-people-actions";

export function InvitationRow({
  invitation,
  bordered,
  pending,
  actions,
}: {
  invitation: HubManagedInvitation;
  bordered: boolean;
  pending: boolean;
  actions: ReturnType<typeof useInvitationActions>;
}) {
  const reinvite = useCallback(() => actions.reinvite(invitation), [actions, invitation]);
  const cancel = useCallback(() => actions.cancel(invitation), [actions, invitation]);
  const copyLink = useCallback(() => actions.copyLink(invitation), [actions, invitation]);
  const menu = useMemo(
    () => [
      {
        label: actions.copiedId === invitation.id ? "Link copied" : "Copy link",
        onSelect: copyLink,
      },
      { label: "Cancel invitation", onSelect: cancel, destructive: true },
    ],
    [actions.copiedId, cancel, copyLink, invitation.id],
  );
  const teams = invitationTeams(invitation);
  const teamNames = teams.length === 0 ? "No Team" : teams.map(({ name }) => name).join(", ");
  const expired = invitationState(invitation.expiresAt) === "expired";
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{invitation.email}</Text>
        <Text
          style={settingsStyles.rowHint}
        >{`${capitalizeLabel(invitation.role)} · ${teamNames}`}</Text>
        <Text style={settingsStyles.rowHint}>
          {`${invitationSentLabel(invitation)} · ${invitationExpiryLabel(invitation.expiresAt)}`}
        </Text>
      </View>
      <View style={styles.actions}>
        {/* The same request either way: a re-invite restarts the 48-hour lifetime. */}
        <Button size="xs" variant="outline" disabled={pending} onPress={reinvite}>
          {expired ? "Renew" : "Resend"}
        </Button>
        <RowActionsMenu
          label={`Actions for ${invitation.email}`}
          actions={menu}
          disabled={pending}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
}));
