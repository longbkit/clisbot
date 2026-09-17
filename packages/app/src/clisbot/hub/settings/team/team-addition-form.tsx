import type { UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import type { HubAccessAssignmentsSchema, HubAccessCatalogSchema } from "../../contracts";
import { AccessSummary, subjectAssignments } from "../access-summary";
import { capitalizeLabel, countLabel } from "../labels";
import { MultiSelectField, type MultiSelection } from "../multi-select-field";
import {
  applyTeamAdditions,
  canApplyTeamAdditions,
  pendingInvitationNotes,
  planTeamAdditions,
  teamAdditionSummary,
  type TeamAdditionPlan,
} from "./team-additions";
import type {
  HubAccount,
  HubManagedInvitation,
  HubTeam,
  InvitationRole,
  TeamResources,
} from "./types";
import type { TeamActions } from "./use-team-actions";

const ROLE_OPTIONS: SelectFieldOption<InvitationRole>[] = [
  { id: "member", value: "member", label: "Member" },
  { id: "admin", value: "admin", label: "Admin" },
];

export interface TeamAdditionDraft {
  pickedUserIds: readonly string[];
  emailText: string;
  teamIds: readonly string[];
  role: InvitationRole;
  /** Bumped when the email field must show a new value it did not type itself. */
  emailResetKey: number;
}

const EMPTY_INVITATIONS: HubManagedInvitation[] = [];

const EMPTY_DRAFT: TeamAdditionDraft = {
  pickedUserIds: [],
  emailText: "",
  teamIds: [],
  role: "member",
  emailResetKey: 0,
};

/**
 * The "Add people to Teams" draft. The Team settings screen owns it, so opening a Member or Team
 * and coming back keeps what was typed, and a Team detail can start a draft for that Team.
 */
export function useTeamAdditionDraft() {
  const [draft, setDraft] = useState<TeamAdditionDraft>(EMPTY_DRAFT);
  const update = useCallback(
    (patch: Partial<TeamAdditionDraft>) => setDraft((current) => ({ ...current, ...patch })),
    [],
  );
  const startWithTeams = useCallback(
    (teamIds: string[]) => {
      if (teamIds.length > 0) update({ teamIds });
    },
    [update],
  );
  return useMemo(() => ({ draft, update, startWithTeams }), [draft, startWithTeams, update]);
}

export type TeamAdditionDraftState = ReturnType<typeof useTeamAdditionDraft>;

export function TeamAdditionForm({
  hub,
  resources,
  actions,
  draftState,
}: {
  hub: HubAccount;
  resources: TeamResources;
  actions: TeamActions;
  draftState: TeamAdditionDraftState;
}) {
  const { draft } = draftState;
  const members = resources.members.data?.members;
  const teams = resources.teams.data?.teams;
  const invitations = hub.signedIn?.team?.invitations;
  const plan = useMemo(
    () =>
      planTeamAdditions({
        pickedUserIds: draft.pickedUserIds,
        emailText: draft.emailText,
        teamIds: draft.teamIds,
        members: members ?? [],
        teams: teams ?? [],
        invitations: invitations ?? EMPTY_INVITATIONS,
      }),
    [draft.emailText, draft.pickedUserIds, draft.teamIds, invitations, members, teams],
  );
  const [result, setResult] = useState<string | null>(null);
  // A success note describes the last submit only; editing the next draft clears it.
  useEffect(() => setResult(null), [draft.emailText, draft.pickedUserIds, draft.teamIds]);
  const submit = useSubmitTeamAdditions({ hub, resources, actions, draftState, plan, setResult });
  const previewReady =
    plan.teamIds.length === 0 || accessPreviewReady(resources.assignments, resources.catalog);
  // Until the roster loads, a typed Member email would be mistaken for a new person.
  const ready =
    resources.members.data !== undefined &&
    canApplyTeamAdditions(plan) &&
    previewReady &&
    !actions.pending;
  return (
    <View style={[settingsStyles.card, styles.form]}>
      <PeopleFields
        draftState={draftState}
        members={members ?? []}
        plan={plan}
        disabled={actions.pending}
      />
      <TeamFields
        draftState={draftState}
        teams={teams ?? []}
        plan={plan}
        disabled={actions.pending}
      />
      <TeamAdditionReview plan={plan} role={draft.role} teams={teams ?? []} resources={resources} />
      {result === null ? null : <Alert variant="success" title={result} />}
      <Button disabled={!ready} loading={actions.pending} onPress={submit}>
        {submitLabel(plan)}
      </Button>
      {plan.members.length > 0 && plan.teamIds.length === 0 ? (
        <Text style={settingsStyles.rowHint}>Choose at least one Team for existing Members.</Text>
      ) : null}
    </View>
  );
}

function PeopleFields({
  draftState,
  members,
  plan,
  disabled,
}: {
  draftState: TeamAdditionDraftState;
  members: readonly { userId: string; name: string; email: string; role: string }[];
  plan: TeamAdditionPlan;
  disabled: boolean;
}) {
  const { draft, update } = draftState;
  const compact = useIsCompactFormFactor();
  const memberOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      members.map((member) => ({
        id: member.userId,
        value: member.userId,
        label: member.name,
        description: `${member.email} · ${capitalizeLabel(member.role)}`,
      })),
    [members],
  );
  const pick = useCallback(
    (value: MultiSelection) => update({ pickedUserIds: value === "*" ? [] : value }),
    [update],
  );
  const setEmails = useCallback((emailText: string) => update({ emailText }), [update]);
  return (
    <>
      <MultiSelectField
        label="Members"
        hint="People who already use this Hub. Search by name or email."
        options={memberOptions}
        value={draft.pickedUserIds}
        onChange={pick}
        disabled={disabled || memberOptions.length === 0}
        placeholder="Choose Members"
        searchPlaceholder="Name or email"
      />
      <Field
        label="Emails"
        hint={emailHint(
          plan,
          plan.members.filter(({ userId }) => !draft.pickedUserIds.includes(userId)).length,
        )}
        error={plan.invalid.length > 0 ? `Not an email: ${plan.invalid.join(", ")}` : undefined}
      >
        <FormTextInput
          size={compact ? "md" : "sm"}
          initialValue={draft.emailText}
          resetKey={draft.emailResetKey}
          onChangeText={setEmails}
          placeholder={"teammate@example.com\nanother@example.com"}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
        />
      </Field>
    </>
  );
}

function TeamFields({
  draftState,
  teams,
  plan,
  disabled,
}: {
  draftState: TeamAdditionDraftState;
  teams: readonly HubTeam[];
  plan: TeamAdditionPlan;
  disabled: boolean;
}) {
  const { draft, update } = draftState;
  const compact = useIsCompactFormFactor();
  const teamOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      teams.map((team) => ({
        id: team.id,
        value: team.id,
        label: team.name,
        description: countLabel(team.userIds.length, "Member"),
      })),
    [teams],
  );
  const chooseTeams = useCallback(
    (value: MultiSelection) => update({ teamIds: value === "*" ? [] : value }),
    [update],
  );
  const setRole = useCallback((role: InvitationRole) => update({ role }), [update]);
  const roleDisplay = useMemo(() => ({ label: capitalizeLabel(draft.role) }), [draft.role]);
  return (
    <>
      <MultiSelectField
        label="Teams"
        hint={teams.length === 0 ? "Create a Team first." : "People join every Team you choose."}
        options={teamOptions}
        value={draft.teamIds}
        onChange={chooseTeams}
        disabled={disabled || teams.length === 0}
        placeholder="Choose Teams"
        searchPlaceholder="Team name"
      />
      {plan.invitees.length > 0 ? (
        <SelectField
          size={compact ? "md" : "sm"}
          label="Organization role for invitations"
          value={draft.role}
          selectedDisplay={roleDisplay}
          options={ROLE_OPTIONS}
          onChange={setRole}
          placeholder="Choose a role"
          emptyText="No organization roles are available."
          title="Organization role"
          disabled={disabled}
        />
      ) : null}
    </>
  );
}

function useSubmitTeamAdditions({
  hub,
  resources,
  actions,
  draftState,
  plan,
  setResult,
}: {
  hub: HubAccount;
  resources: TeamResources;
  actions: TeamActions;
  draftState: TeamAdditionDraftState;
  plan: TeamAdditionPlan;
  setResult(value: string | null): void;
}) {
  const { draft, update } = draftState;
  return useCallback(() => {
    setResult(null);
    void actions.run(async () => {
      const failures = await applyTeamAdditions(
        plan,
        draft.role,
        resources.teams.data?.teams ?? [],
        {
          addTeamMember: actions.addTeamMember,
          invite: (input) => hub.inviteMember(input),
        },
      );
      await Promise.all([
        resources.teams.refetch(),
        resources.assignments.refetch(),
        hub.refresh(),
      ]);
      const failed = new Set(failures.map(({ key }) => key));
      // Whoever Hub refused stays in the form with the same Teams and role, ready to retry.
      update({
        pickedUserIds: plan.members.flatMap(({ userId }) => (failed.has(userId) ? [userId] : [])),
        emailText: failures.map(({ label }) => label).join("\n"),
        emailResetKey: draft.emailResetKey + 1,
        ...(failures.length === 0 ? { teamIds: [], role: "member" as const } : {}),
      });
      const done = plan.members.length + plan.invitees.length - failures.length;
      if (failures.length > 0) {
        const details = failures.map(({ label, message }) => `${label}: ${message}`).join("; ");
        throw new Error(`${String(done)} of ${String(done + failures.length)} done. ${details}`);
      }
      setResult(teamAdditionResult(plan));
    });
  }, [actions, draft.emailResetKey, draft.role, hub, plan, resources, setResult, update]);
}

function TeamAdditionReview({
  plan,
  role,
  teams,
  resources,
}: {
  plan: TeamAdditionPlan;
  role: InvitationRole;
  teams: readonly HubTeam[];
  resources: TeamResources;
}) {
  const summary = teamAdditionSummary(plan, teams);
  if (summary.length === 0) return null;
  const notes = pendingInvitationNotes(plan, role);
  return (
    <View style={styles.review}>
      {notes.length === 0 ? null : (
        <Alert variant="warning" title="Already invited" description={notes.join("\n")} />
      )}
      <Alert
        variant="info"
        title={summary}
        description={
          plan.teamIds.length === 0
            ? "Invitations join the organization only. Assign access later if needed."
            : "Everyone receives the access of the chosen Teams, shown below."
        }
      />
      {plan.teamIds.length > 0 ? (
        <TeamAccessPreview teamIds={plan.teamIds} teams={teams} resources={resources} />
      ) : null}
    </View>
  );
}

function accessPreviewReady(
  assignments: UseQueryResult<z.infer<typeof HubAccessAssignmentsSchema>, Error>,
  catalog: UseQueryResult<z.infer<typeof HubAccessCatalogSchema>, Error>,
): boolean {
  return (
    assignments.data !== undefined &&
    catalog.data !== undefined &&
    !assignments.isError &&
    !catalog.isError
  );
}

function TeamAccessPreview({
  teamIds,
  teams,
  resources,
}: {
  teamIds: readonly string[];
  teams: readonly HubTeam[];
  resources: TeamResources;
}) {
  const { assignments, catalog } = resources;
  const retry = useCallback(() => {
    void Promise.all([assignments.refetch(), catalog.refetch()]);
  }, [assignments, catalog]);
  if (assignments.isPending || catalog.isPending) {
    return <Text style={settingsStyles.rowHint}>Loading Team access...</Text>;
  }
  if (!accessPreviewReady(assignments, catalog) || !assignments.data || !catalog.data) {
    return (
      <Alert
        variant="error"
        title="Team access unavailable"
        description="Refresh the access preview before adding people."
      >
        <Button size="sm" variant="outline" onPress={retry}>
          Retry
        </Button>
      </Alert>
    );
  }
  const entries = teams
    .filter(({ id }) => teamIds.includes(id))
    .flatMap((team) =>
      subjectAssignments(assignments.data.assignments, "team", team.id).map((assignment) => ({
        assignment,
        source: `Via ${team.name}`,
      })),
    );
  return (
    <View>
      <Text style={settingsStyles.rowHint}>{countLabel(entries.length, "current assignment")}</Text>
      <AccessSummary
        entries={entries}
        resources={catalog.data.resources}
        accessLevels={catalog.data.accessLevels}
        emptyMessage="The chosen Teams have no resource access"
      />
    </View>
  );
}

function teamAdditionResult(plan: TeamAdditionPlan): string {
  const added = plan.teamIds.length > 0 ? plan.members.length : 0;
  const parts = [
    ...(added > 0 ? [`Added ${countLabel(added, "Member")} to Teams`] : []),
    ...(plan.invitees.length > 0 ? [`Sent ${countLabel(plan.invitees.length, "invitation")}`] : []),
  ];
  return `${parts.join(" · ")}.`;
}

function emailHint(plan: TeamAdditionPlan, typedMembers: number): string {
  const parts = [
    ...(typedMembers > 0 ? [`${countLabel(typedMembers, "existing Member")} recognized`] : []),
    ...(plan.invitees.length > 0
      ? [`${countLabel(plan.invitees.length, "new person", "new people")} to invite`]
      : []),
  ];
  if (parts.length === 0) {
    return "Paste emails, separated by commas or new lines. Emails of existing Members are recognized.";
  }
  return `${parts.join(" · ")}.`;
}

function submitLabel(plan: TeamAdditionPlan): string {
  const adds = plan.teamIds.length > 0 ? plan.members.length : 0;
  const invites = plan.invitees.length;
  if (adds > 0 && invites > 0) return `Add ${String(adds)} and invite ${String(invites)}`;
  if (invites > 0) return invites > 1 ? `Send ${String(invites)} invitations` : "Send invitation";
  return adds > 1 ? `Add ${String(adds)} Members to Teams` : "Add to Teams";
}

const styles = StyleSheet.create((theme) => ({
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  review: {
    gap: theme.spacing[2],
  },
}));
