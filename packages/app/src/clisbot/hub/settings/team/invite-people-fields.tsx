import { useCallback, useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/i18next";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  MultiSelectField,
  type MultiSelectCreate,
  type MultiSelection,
} from "../multi-select-field";
import { roleLabel } from "./member-role";
import type { TeamAdditionPlan } from "./team-additions";
import type { HubTeam, InvitationRole } from "./types";
import type { InviteDraftState } from "./use-invite-people";

function roleOptions(t: TFunction): SelectFieldOption<InvitationRole>[] {
  return [
    { id: "member", value: "member", label: roleLabel("member", t) },
    { id: "admin", value: "admin", label: roleLabel("admin", t) },
  ];
}

export function InvitePeopleFields({
  draftState,
  plan,
  unknown,
  teams,
  roleLocked,
  disabled,
  createTeam,
}: {
  draftState: InviteDraftState;
  plan: TeamAdditionPlan;
  unknown: readonly string[];
  /** The Teams the viewer may invite into. */
  teams: readonly HubTeam[];
  /** A Team Admin invites only as Member. */
  roleLocked: boolean;
  disabled: boolean;
  /** For people who may create Teams: a typed name that matches no Team creates one. */
  createTeam: MultiSelectCreate | undefined;
}) {
  const { t } = useTranslation();
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
        description: t("hub.team.counts.members", { count: team.userIds.length }),
      })),
    [t, teams],
  );
  const roles = useMemo(() => roleOptions(t), [t]);
  const roleDisplay = useMemo(() => ({ label: roleLabel(draft.role, t) }), [draft.role, t]);
  return (
    <>
      <Field
        label={t("hub.team.invite.people.label")}
        hint={peopleHint(plan)}
        error={peopleError(plan, unknown)}
      >
        <FormTextInput
          size={compact ? "md" : "sm"}
          initialValue={draft.text}
          resetKey={draft.textResetKey}
          onChangeText={setText}
          placeholder={t("hub.team.invite.people.placeholder")}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
        />
      </Field>
      <MultiSelectField
        label={t("hub.team.teamPicker.label")}
        hint={teamsHint(teams.length, createTeam !== undefined)}
        options={teamOptions}
        value={draft.teamIds}
        onChange={chooseTeams}
        disabled={disabled || (teams.length === 0 && createTeam === undefined)}
        placeholder={
          createTeam === undefined
            ? t("hub.team.teamPicker.choose")
            : t("hub.team.teamPicker.chooseOrCreate")
        }
        searchPlaceholder={
          createTeam === undefined
            ? t("hub.team.teamPicker.search")
            : t("hub.team.teamPicker.searchOrCreate")
        }
        {...(createTeam === undefined ? {} : { create: createTeam })}
      />
      {plan.invitees.length > 0 ? (
        <SelectField
          size={compact ? "md" : "sm"}
          label={t("hub.team.invite.role.label")}
          value={draft.role}
          selectedDisplay={roleDisplay}
          options={roles}
          onChange={setRole}
          placeholder={t("hub.team.invite.role.placeholder")}
          emptyText={t("hub.team.invite.role.empty")}
          title={t("hub.team.invite.role.title")}
          disabled={disabled || roleLocked}
          hint={roleLocked ? t("hub.team.invite.role.locked") : undefined}
        />
      ) : null}
    </>
  );
}

function teamsHint(teams: number, canCreate: boolean): string {
  if (teams > 0) return i18n.t("hub.team.invite.teamsHint");
  return canCreate
    ? i18n.t("hub.team.teamPicker.typeToCreate")
    : i18n.t("hub.team.teamPicker.createFirst");
}

function peopleHint(plan: TeamAdditionPlan): string {
  const parts = [
    ...(plan.members.length > 0
      ? [i18n.t("hub.team.invite.people.recognized", { count: plan.members.length })]
      : []),
    ...(plan.invitees.length > 0
      ? [i18n.t("hub.team.invite.people.toInvite", { count: plan.invitees.length })]
      : []),
  ];
  if (parts.length === 0) return i18n.t("hub.team.invite.people.hint");
  return i18n.t("hub.team.invite.people.summary", { parts: parts.join(" · ") });
}

function peopleError(plan: TeamAdditionPlan, unknown: readonly string[]): string | undefined {
  const problems = [
    ...(plan.invalid.length > 0
      ? [i18n.t("hub.team.invite.people.notEmail", { entries: plan.invalid.join(", ") })]
      : []),
    ...(unknown.length > 0
      ? [i18n.t("hub.team.invite.people.notMember", { entries: unknown.join(", ") })]
      : []),
  ];
  return problems.length === 0 ? undefined : problems.join(" · ");
}
