import { useCallback, useMemo } from "react";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { capitalizeLabel, countLabel } from "../labels";
import { MultiSelectField, type MultiSelection } from "../multi-select-field";
import type { TeamAdditionPlan } from "./team-additions";
import type { HubTeam, InvitationRole } from "./types";
import type { InviteDraftState } from "./use-invite-people";

const ROLE_OPTIONS: SelectFieldOption<InvitationRole>[] = [
  { id: "member", value: "member", label: "Member" },
  { id: "admin", value: "admin", label: "Admin" },
];

export function InvitePeopleFields({
  draftState,
  plan,
  unknown,
  teams,
  roleLocked,
  disabled,
}: {
  draftState: InviteDraftState;
  plan: TeamAdditionPlan;
  unknown: readonly string[];
  /** The Teams the viewer may invite into. */
  teams: readonly HubTeam[];
  /** A Team Admin invites only as Member. */
  roleLocked: boolean;
  disabled: boolean;
}) {
  const { draft, update } = draftState;
  const compact = useIsCompactFormFactor();
  const setText = useCallback((text: string) => update({ text }), [update]);
  const chooseTeams = useCallback(
    (value: MultiSelection) => update({ teamIds: value === "*" ? [] : value }),
    [update],
  );
  const setRole = useCallback((role: InvitationRole) => update({ role }), [update]);
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
  const roleDisplay = useMemo(() => ({ label: capitalizeLabel(draft.role) }), [draft.role]);
  return (
    <>
      <Field label="People" hint={peopleHint(plan)} error={peopleError(plan, unknown)}>
        <FormTextInput
          size={compact ? "md" : "sm"}
          initialValue={draft.text}
          resetKey={draft.textResetKey}
          onChangeText={setText}
          placeholder={"Alice, bob@example.com\nanother@example.com"}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
        />
      </Field>
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
          label="Organization role for new people"
          value={draft.role}
          selectedDisplay={roleDisplay}
          options={ROLE_OPTIONS}
          onChange={setRole}
          placeholder="Choose a role"
          emptyText="No organization roles are available."
          title="Organization role"
          disabled={disabled || roleLocked}
          hint={roleLocked ? "Team Admins invite people as Members." : undefined}
        />
      ) : null}
    </>
  );
}

function peopleHint(plan: TeamAdditionPlan): string {
  const parts = [
    ...(plan.members.length > 0 ? [`${countLabel(plan.members.length, "Member")} recognized`] : []),
    ...(plan.invitees.length > 0
      ? [`${countLabel(plan.invitees.length, "new person", "new people")} to invite`]
      : []),
  ];
  if (parts.length === 0) {
    return "Names of Members or emails, separated by commas or new lines. Existing Members are recognized.";
  }
  return `${parts.join(" · ")}.`;
}

function peopleError(plan: TeamAdditionPlan, unknown: readonly string[]): string | undefined {
  const problems = [
    ...(plan.invalid.length > 0 ? [`Not an email: ${plan.invalid.join(", ")}`] : []),
    ...(unknown.length > 0 ? [`Not a Member: ${unknown.join(", ")}`] : []),
  ];
  return problems.length === 0 ? undefined : problems.join(" · ");
}
