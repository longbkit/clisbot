// The two people pickers Who and Where share: Teams or Members from one list,
// and Guests by name. One component each, so both halves of a rule pick alike.

import React, { useCallback, useMemo } from "react";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { PickerRow, type AudienceOption } from "./channel-route-audience-controls";
import { SenderSelectionFields } from "./conversation-picker-field";
import { MultiSelectField, type MultiSelection } from "./multi-select-field";

const TEAM_PREFIX = "team:";
const MEMBER_PREFIX = "member:";

/** Teams, then Members, in one list: the same picker Access uses for a grant. */
export function TeamsOrMembersField({
  hint,
  teams,
  members,
  selectedTeams,
  selectedMembers,
  onChange,
  disabled,
}: {
  hint: string;
  teams: readonly AudienceOption[];
  /** Members by membership id. */
  members: readonly AudienceOption[];
  selectedTeams: readonly string[];
  selectedMembers: readonly string[];
  onChange(picked: { teams: string[]; members: string[] }): void;
  disabled: boolean;
}) {
  const options = useMemo<SelectFieldOption<string>[]>(
    () => [
      ...teams.map((team) => prefixedOption(TEAM_PREFIX, team, "Teams")),
      ...members.map((member) => prefixedOption(MEMBER_PREFIX, member, "Members")),
    ],
    [members, teams],
  );
  const value = useMemo(
    () => [
      ...selectedTeams.map((id) => `${TEAM_PREFIX}${id}`),
      ...selectedMembers.map((id) => `${MEMBER_PREFIX}${id}`),
    ],
    [selectedMembers, selectedTeams],
  );
  const change = useCallback(
    (picked: MultiSelection) => {
      // No `allLabel` is offered, so the wildcard never arrives.
      if (picked === "*") return;
      onChange({
        teams: unprefixed(picked, TEAM_PREFIX),
        members: unprefixed(picked, MEMBER_PREFIX),
      });
    },
    [onChange],
  );
  return (
    <MultiSelectField
      label="Specific Teams or Members"
      hint={hint}
      options={options}
      value={value}
      onChange={change}
      disabled={disabled}
      placeholder="Choose Teams or Members"
      searchPlaceholder="Search Teams and Members"
    />
  );
}

function prefixedOption(prefix: string, option: AudienceOption, group: string) {
  const id = `${prefix}${option.id}`;
  return { id, value: id, label: option.name, group };
}

function unprefixed(ids: readonly string[], prefix: string): string[] {
  return ids.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length));
}

/**
 * Guests, picked the way conversations are: from the people who already messaged the
 * bot, or by id. `among` limits the choice to the Guests a rule's Who names.
 */
export function GuestsField({
  hint,
  channel,
  accountId,
  among,
  value,
  onChange,
  disabled,
}: {
  hint: string;
  channel: string | null;
  accountId: string | null;
  among: readonly string[] | null;
  /** Channel identities, comma-separated. */
  value: string;
  onChange(value: string): void;
  disabled: boolean;
}) {
  return (
    <PickerRow label="Specific Guests">
      <SenderSelectionFields
        channel={channel}
        accountId={accountId}
        among={among}
        hint={hint}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </PickerRow>
  );
}
