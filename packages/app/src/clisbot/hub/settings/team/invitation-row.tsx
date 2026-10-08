import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { invitationTeams } from "../../contracts";
import { invitationExpiryLabel, invitationSentLabel, invitationState } from "./invitation-status";
import { roleLabel } from "./member-role";
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
  const { t } = useTranslation();
  const reinvite = useCallback(() => actions.reinvite(invitation), [actions, invitation]);
  const cancel = useCallback(() => actions.cancel(invitation), [actions, invitation]);
  const copyLink = useCallback(() => actions.copyLink(invitation), [actions, invitation]);
  const menu = useMemo(
    () => [
      {
        label:
          actions.copiedId === invitation.id
            ? t("hub.team.invitations.linkCopied")
            : t("hub.team.invitations.copyLink"),
        onSelect: copyLink,
      },
      { label: t("hub.team.invitations.cancel"), onSelect: cancel, destructive: true },
    ],
    [actions.copiedId, cancel, copyLink, invitation.id, t],
  );
  const teams = invitationTeams(invitation);
  const teamNames =
    teams.length === 0
      ? t("hub.team.invitations.noTeam")
      : teams.map(({ name }) => name).join(", ");
  const expired = invitationState(invitation.expiresAt) === "expired";
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{invitation.email}</Text>
        <Text
          style={settingsStyles.rowHint}
        >{`${roleLabel(invitation.role, t)} · ${teamNames}`}</Text>
        <Text style={settingsStyles.rowHint}>
          {`${invitationSentLabel(invitation)} · ${invitationExpiryLabel(invitation.expiresAt)}`}
        </Text>
      </View>
      <View style={styles.actions}>
        {/* The same request either way: a re-invite restarts the 48-hour lifetime. */}
        <Button size="xs" variant="outline" disabled={pending} onPress={reinvite}>
          {expired ? t("hub.team.invitations.renew") : t("hub.team.invitations.resend")}
        </Button>
        <RowActionsMenu
          label={t("hub.team.actions.actionsFor", { name: invitation.email })}
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
