import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { settingsStyles } from "@/styles/settings";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { invitationTeams } from "../../contracts";
import { capitalizeLabel } from "../labels";
import { EmptyRow } from "../resource-rows";
import { matchesSearch } from "../search-text";
import { invitationTeamBody } from "./team-additions";
import type { HubAccount, HubManagedInvitation } from "./types";
import type { TeamActions } from "./use-team-actions";

/** Above this many invitations the list gets a search box. */
const INVITATION_SEARCH_THRESHOLD = 6;
const HOUR_MS = 60 * 60 * 1000;

export function PendingInvitations({
  hub,
  invitations,
  actions,
}: {
  hub: HubAccount;
  invitations: readonly HubManagedInvitation[];
  actions: TeamActions;
}) {
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const visible = useMemo(
    () =>
      invitations.filter((invitation) =>
        matchesSearch(query, [
          invitation.email,
          ...invitationTeams(invitation).map(({ name }) => name),
        ]),
      ),
    [invitations, query],
  );
  return (
    <SettingsSection title="Pending invitations">
      {invitations.length > INVITATION_SEARCH_THRESHOLD ? (
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search email or Team"
          clearAccessibilityLabel="Clear invitation search"
        />
      ) : null}
      <View style={settingsStyles.card}>
        {visible.length === 0 ? (
          <EmptyRow
            message={invitations.length === 0 ? "No pending invitations." : "No invitations match."}
          />
        ) : (
          visible.map((invitation, index) => (
            <PendingInvitationRow
              key={invitation.id}
              hub={hub}
              invitation={invitation}
              bordered={index > 0}
              copied={copiedId === invitation.id}
              setCopiedId={setCopiedId}
              actions={actions}
            />
          ))
        )}
      </View>
    </SettingsSection>
  );
}

function PendingInvitationRow({
  hub,
  invitation,
  bordered,
  copied,
  setCopiedId,
  actions,
}: {
  hub: HubAccount;
  invitation: HubManagedInvitation;
  bordered: boolean;
  copied: boolean;
  setCopiedId(value: string): void;
  actions: TeamActions;
}) {
  const { pending, run, setMutationError } = actions;
  const copy = useCallback(() => {
    void copyToClipboard(invitation.link)
      .then(() => setCopiedId(invitation.id))
      .catch((error: unknown) =>
        setMutationError(
          error instanceof Error ? error.message : "Unable to copy invitation link.",
        ),
      );
  }, [invitation.id, invitation.link, setCopiedId, setMutationError]);
  const cancel = useCallback(
    () => void run(() => hub.cancelInvitation(invitation.id)),
    [hub, invitation.id, run],
  );
  // Re-inviting with the same role and Teams restarts the invitation's lifetime.
  const renew = useCallback(
    () =>
      void run(() =>
        hub.inviteMember({
          email: invitation.email,
          role: invitation.role,
          ...invitationTeamBody(invitationTeams(invitation).map(({ id }) => id)),
        }),
      ),
    [hub, invitation, run],
  );
  const teams = invitationTeams(invitation);
  const teamNames = teams.length === 0 ? "No Team" : teams.map(({ name }) => name).join(", ");
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{invitation.email}</Text>
        <Text style={settingsStyles.rowHint}>
          {`${capitalizeLabel(invitation.role)} · ${teamNames}`}
        </Text>
        <Text style={settingsStyles.rowHint}>{expiryLabel(invitation.expiresAt)}</Text>
      </View>
      <View style={styles.actions}>
        <Button size="xs" variant="ghost" disabled={pending} onPress={renew}>
          Renew
        </Button>
        <Button size="xs" variant="outline" disabled={pending} onPress={copy}>
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button size="xs" variant="ghost" disabled={pending} onPress={cancel}>
          Cancel
        </Button>
      </View>
    </View>
  );
}

function expiryLabel(expiresAt: string, now = Date.now()): string {
  const hours = Math.floor((Date.parse(expiresAt) - now) / HOUR_MS);
  if (Number.isNaN(hours)) return "Pending";
  if (hours < 1) return "Expires within an hour";
  if (hours < 48) return `Expires in ${String(hours)} h`;
  return `Expires in ${String(Math.floor(hours / 24))} days`;
}

const styles = StyleSheet.create((theme) => ({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
