// The Where half of one audience rule. Each place is a switch, off by default;
// turning it on asks one exclusive question: all of them, or only the named ones.

import React, { useCallback, useMemo } from "react";
import { Alert } from "@/components/ui/alert";
import { RouteBehaviorSwitch } from "./channel-route-behavior-rows";
import {
  extraConversations,
  visibilityFilterMatchesNothing,
  type AudienceGroupScope,
  type AudienceNames,
  type AudienceRuleDraft,
} from "./channel-route-audience";
import {
  NestedRows,
  OptionChips,
  PickerRow,
  type AudienceOption,
} from "./channel-route-audience-controls";
import { splitConversationIds } from "../conversation-picker";
import { GuestsField, TeamsOrMembersField } from "./channel-route-audience-people";
import { ConversationSelectionFields } from "./conversation-picker-field";

type Where = AudienceRuleDraft["where"];

/** What the Where needs to know about the account the Route belongs to. */
export interface AudienceWherePlace {
  channelName: string;
  reportsVisibility: boolean;
  observedChannel: string | null;
  accountId: string | null;
}

/** What the DM lists pick from: the rule's own Who, and the organization's people. */
interface DmSenderSources {
  who: AudienceRuleDraft["who"];
  place: AudienceWherePlace;
  teams: readonly AudienceOption[];
  /** Members by membership id. */
  members: readonly AudienceOption[];
}

interface WherePartProps {
  where: Where;
  disabled: boolean;
  setWhere(patch: Partial<Where>): void;
}

export function AudienceWhereFields({
  where,
  who,
  place,
  teams,
  members,
  names,
  disabled,
  setWhere,
}: WherePartProps & DmSenderSources & { names: AudienceNames }) {
  return (
    <PickerRow label="Where">
      <NestedRows>
        <DirectMessagesPart
          where={where}
          who={who}
          place={place}
          teams={teams}
          members={members}
          disabled={disabled}
          setWhere={setWhere}
        />
        <GroupChatsPart
          where={where}
          place={place}
          names={names}
          disabled={disabled}
          setWhere={setWhere}
        />
      </NestedRows>
    </PickerRow>
  );
}

const DM_SCOPE_OPTIONS: readonly AudienceOption[] = [
  { id: "all", name: "All direct messages" },
  { id: "specific", name: "Specific people" },
];

function DirectMessagesPart({
  where,
  who,
  place,
  teams,
  members,
  disabled,
  setWhere,
}: WherePartProps & DmSenderSources) {
  // Turning it on starts at the narrow choice: every DM is a deliberate pick.
  const toggle = useCallback(
    (on: boolean) => setWhere({ dm: on ? "specific" : "off" }),
    [setWhere],
  );
  const changeScope = useCallback(
    (value: string) => setWhere({ dm: value === "specific" ? "specific" : "all" }),
    [setWhere],
  );
  return (
    <>
      <RouteBehaviorSwitch
        label="Direct messages"
        value={where.dm !== "off"}
        onChange={toggle}
        disabled={disabled}
      />
      {where.dm === "off" ? null : (
        <NestedRows>
          <PickerRow label="Which direct messages" hint="Everyone under Who, or only some of them.">
            <OptionChips
              options={DM_SCOPE_OPTIONS}
              selected={[where.dm]}
              disabled={disabled}
              onToggle={changeScope}
              empty=""
            />
          </PickerRow>
          {where.dm === "specific" ? (
            <SpecificDmSenders
              where={where}
              who={who}
              place={place}
              teams={teams}
              members={members}
              disabled={disabled}
              setWhere={setWhere}
            />
          ) : null}
        </NestedRows>
      )}
    </>
  );
}

/** The senders a rule narrows its DMs to, picked the way Who picks them. */
function SpecificDmSenders({
  where,
  who,
  place,
  teams,
  members,
  disabled,
  setWhere,
}: WherePartProps & DmSenderSources) {
  const changePeople = useCallback(
    (picked: { teams: string[]; members: string[] }) =>
      setWhere({ dmTeams: picked.teams, dmMembers: picked.members }),
    [setWhere],
  );
  const changeGuests = useCallback(
    (dmIdentities: string) => setWhere({ dmIdentities }),
    [setWhere],
  );
  // The list narrows the Who: under Anyone every Guest seen is a choice, otherwise Who's Guests.
  const whoGuests = useMemo(
    () => (who.anyone ? null : splitConversationIds(who.identities)),
    [who.anyone, who.identities],
  );
  // Who names only Members: no Guest could pass it, so there is none to narrow to.
  const offersGuests =
    whoGuests === null || whoGuests.length > 0 || where.dmIdentities.trim().length > 0;
  return (
    <>
      <TeamsOrMembersField
        hint="Of the people under Who, only these may DM."
        teams={teams}
        members={members}
        selectedTeams={where.dmTeams}
        selectedMembers={where.dmMembers}
        onChange={changePeople}
        disabled={disabled}
      />
      {offersGuests ? (
        <GuestsField
          hint="Of the Guests under Who, only these may DM."
          channel={place.observedChannel}
          accountId={place.accountId}
          among={whoGuests}
          value={where.dmIdentities}
          onChange={changeGuests}
          disabled={disabled}
        />
      ) : null}
    </>
  );
}

/** What the chosen group option covers, in one line. */
function groupScopeHint(groups: AudienceGroupScope): string {
  if (groups === "all") return "Every group chat the bot is in, now or later.";
  if (groups === "public" || groups === "private")
    return `Every ${groups} group chat, now or later.`;
  return "Only the conversations you pick.";
}

const GROUP_SCOPE_LABELS: Record<Exclude<AudienceGroupScope, "off">, string> = {
  all: "All group chats",
  public: "Public only",
  private: "Private only",
  specific: "Specific conversations",
};

function GroupChatsPart({
  where,
  place,
  names,
  disabled,
  setWhere,
}: WherePartProps & { place: AudienceWherePlace; names: AudienceNames }) {
  // Turning it on starts at the narrow choice: every group chat is a deliberate pick.
  const toggle = useCallback(
    (on: boolean) => setWhere({ groups: on ? "specific" : "off" }),
    [setWhere],
  );
  const changeScope = useCallback(
    (value: string) => {
      const groups = value as AudienceGroupScope;
      // The options are exclusive: leaving Specific drops its list.
      setWhere(groups === "specific" ? { groups } : { groups, conversations: "" });
    },
    [setWhere],
  );
  const changeConversations = useCallback(
    (conversations: string) => setWhere({ conversations }),
    [setWhere],
  );
  // A stored public/private filter stays selectable where it matches nothing.
  const filtered = where.groups === "public" || where.groups === "private";
  const scopes = useMemo<AudienceOption[]>(
    () =>
      (place.reportsVisibility || filtered
        ? (["all", "public", "private", "specific"] as const)
        : (["all", "specific"] as const)
      ).map((id) => ({ id, name: GROUP_SCOPE_LABELS[id] })),
    [filtered, place.reportsVisibility],
  );
  const extra = extraConversations(where);
  return (
    <>
      <RouteBehaviorSwitch
        label="Group chats"
        value={where.groups !== "off"}
        onChange={toggle}
        disabled={disabled}
      />
      {where.groups === "off" ? null : (
        <NestedRows>
          <PickerRow label="Which group chats" hint={groupScopeHint(where.groups)}>
            <OptionChips
              options={scopes}
              selected={[where.groups]}
              disabled={disabled}
              onToggle={changeScope}
              empty=""
            />
          </PickerRow>
          {visibilityFilterMatchesNothing(where, place.reportsVisibility) ? (
            <Alert
              variant="warning"
              title={`${place.channelName} does not report whether a group chat is public or private`}
              description="This filter matches nothing here. Choose All group chats or Specific conversations."
            />
          ) : null}
          {extra.length > 0 ? (
            <Alert
              variant="info"
              title={`Also saved: ${extra.map((id) => names.conversationLabel(id)).join(", ")}`}
              description="Saved by an earlier editor. Choosing an option above replaces them."
            />
          ) : null}
          {where.groups === "specific" ? (
            <ConversationSelectionFields
              channel={place.observedChannel}
              accountId={place.accountId}
              value={where.conversations}
              onChange={changeConversations}
              disabled={disabled}
              hint="Rooms, groups, threads or topics. A thread or topic narrows to it."
              placeholder="C0123, C0456"
            />
          ) : null}
        </NestedRows>
      )}
    </>
  );
}
