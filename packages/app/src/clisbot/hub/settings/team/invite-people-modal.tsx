import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { InviteAccessNote } from "./invite-access-note";
import { InvitePeopleFields } from "./invite-people-fields";
import { invitePreview, pendingInvitationNotes, type TeamAdditionPlan } from "./team-additions";
import type { HubAccount, TeamResources } from "./types";
import {
  useInviteDraft,
  useInvitePlan,
  useSubmitInvite,
  type InviteRequest,
} from "./use-invite-people";
import type { TeamActions } from "./use-team-actions";

const HEADER: SheetHeader = { title: "Invite people" };

/**
 * One modal for everyone who should be somewhere: existing Members join the chosen Teams now,
 * new emails get one invitation that joins the same Teams when the person signs in.
 */
export function InvitePeopleModal({
  hub,
  resources,
  actions,
  request,
  close,
  onDone,
}: {
  hub: HubAccount;
  resources: TeamResources;
  actions: TeamActions;
  request: InviteRequest;
  close(): void;
  onDone(result: string): void;
}) {
  const draftState = useInviteDraft(request);
  const invitations = hub.signedIn?.team?.invitations;
  const { plan, unknown, ready } = useInvitePlan(
    draftState.draft,
    resources,
    invitations,
    actions.pending,
  );
  const done = useCallback(
    (result: string) => {
      onDone(result);
      close();
    },
    [close, onDone],
  );
  const submit = useSubmitInvite({ hub, resources, actions, draftState, plan, onDone: done });
  const teams = resources.teams.data?.teams ?? [];
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button variant="secondary" disabled={actions.pending} onPress={close}>
          Cancel
        </Button>
        <Button variant="default" disabled={!ready} loading={actions.pending} onPress={submit}>
          {submitLabel(plan)}
        </Button>
      </View>
    ),
    [actions.pending, close, plan, ready, submit],
  );
  const preview = invitePreview(plan, teams);
  const notes = pendingInvitationNotes(plan, draftState.draft.role);
  return (
    <AdaptiveModalSheet
      header={HEADER}
      visible
      onClose={close}
      footer={footer}
      desktopMaxWidth={520}
    >
      <View style={styles.body}>
        <InvitePeopleFields
          draftState={draftState}
          plan={plan}
          unknown={unknown}
          teams={teams}
          disabled={actions.pending}
        />
        {preview.length === 0 ? null : <Alert variant="info" title={preview} />}
        <InviteAccessNote resources={resources} teamIds={plan.teamIds} />
        {notes.length === 0 ? null : (
          <Alert variant="warning" title="Already invited" description={notes.join("\n")} />
        )}
        {plan.members.length > 0 && plan.teamIds.length === 0 ? (
          <Text style={settingsStyles.rowHint}>Choose at least one Team for existing Members.</Text>
        ) : null}
        {actions.mutationError ? <Alert variant="error" title={actions.mutationError} /> : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function submitLabel(plan: TeamAdditionPlan): string {
  const adds = plan.teamIds.length > 0 ? plan.members.length : 0;
  const invites = plan.invitees.length;
  if (adds > 0 && invites > 0) return `Add ${String(adds)} and invite ${String(invites)}`;
  if (invites > 0) return invites > 1 ? `Send ${String(invites)} invitations` : "Send invitation";
  return adds > 1 ? `Add ${String(adds)} Members` : "Add to Teams";
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[3] },
  footer: { flex: 1, flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
}));
