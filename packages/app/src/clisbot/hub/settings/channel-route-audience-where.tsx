// Where one Rule applies: direct messages, or group chats — and for group
// chats, which ones. One kind of place per Rule, so each Rule reads as one
// way in (docs/audits/2026-10-05-routes-and-rules.md).

import React, { useCallback, useMemo } from "react";
import { Text } from "react-native";
import { settingsStyles } from "@/styles/settings";
import { Alert } from "@/components/ui/alert";
import {
  extraConversations,
  visibilityFilterMatchesNothing,
  withPlace,
  type AudienceGroupScope,
  type AudienceRuleDraft,
  type RulePlace,
} from "./channel-route-audience";
import { RadioList, type RadioOption } from "./channel-route-audience-controls";
import { ChoiceRow } from "./channel-route-behavior-rows";
import type { AudienceNames } from "./channel-route-rule-summary";
import { ConversationSelectionFields } from "./conversation-picker-field";

/** What the Where needs to know about the account the Route belongs to. */
export interface AudienceWherePlace {
  channelName: string;
  reportsVisibility: boolean;
  observedChannel: string | null;
  accountId: string | null;
}

type Update = (change: (rule: AudienceRuleDraft) => AudienceRuleDraft) => void;

const PLACES: RulePlace[] = ["dm", "groups"];
const PLACE_LABELS: Record<RulePlace, string> = { dm: "Direct messages", groups: "Group chats" };

export function RuleWhereFields({
  rule,
  place,
  names,
  disabled,
  update,
  problem,
}: {
  rule: AudienceRuleDraft;
  place: AudienceWherePlace;
  names: AudienceNames;
  disabled: boolean;
  update: Update;
  /** Why the Where cannot save yet, shown under the chats. */
  problem: string | null;
}) {
  const changePlace = useCallback(
    (value: string) => update((current) => withPlace(current, value as RulePlace)),
    [update],
  );
  return (
    <>
      <ChoiceRow
        label="Where"
        values={PLACES}
        selected={rule.place}
        labels={PLACE_LABELS}
        onChange={changePlace}
        disabled={disabled}
      />
      {rule.place === "groups" ? (
        <GroupChatFields
          rule={rule}
          place={place}
          names={names}
          disabled={disabled}
          update={update}
        />
      ) : null}
      {problem === null ? null : <Text style={settingsStyles.rowError}>{problem}</Text>}
    </>
  );
}

const SCOPE_LABELS: Record<Exclude<AudienceGroupScope, "off">, string> = {
  specific: "Chats I pick",
  all: "Every chat the bot is in",
  public: "Every public chat",
  private: "Every private chat",
};

function GroupChatFields({
  rule,
  place,
  names,
  disabled,
  update,
}: {
  rule: AudienceRuleDraft;
  place: AudienceWherePlace;
  names: AudienceNames;
  disabled: boolean;
  update: Update;
}) {
  const { where } = rule;
  // A stored public/private filter stays selectable where it matches nothing.
  const filtered = where.groups === "public" || where.groups === "private";
  const scopes = useMemo<RadioOption<Exclude<AudienceGroupScope, "off">>[]>(
    () =>
      (place.reportsVisibility || filtered
        ? (["specific", "all", "public", "private"] as const)
        : (["specific", "all"] as const)
      ).map((value) => ({ value, label: SCOPE_LABELS[value] })),
    [filtered, place.reportsVisibility],
  );
  const changeScope = useCallback(
    (groups: Exclude<AudienceGroupScope, "off">) =>
      // The options are exclusive: leaving "Chats I pick" drops its list.
      update((current) => ({
        ...current,
        where: {
          ...current.where,
          groups,
          ...(groups === "specific" ? {} : { conversations: "" }),
        },
      })),
    [update],
  );
  const changeConversations = useCallback(
    (conversations: string) =>
      update((current) => ({ ...current, where: { ...current.where, conversations } })),
    [update],
  );
  const extra = extraConversations(where);
  return (
    <>
      <RadioList
        label="Which chats?"
        options={scopes}
        selected={where.groups === "off" ? "specific" : where.groups}
        onChange={changeScope}
        disabled={disabled}
      />
      {where.groups === "specific" || where.groups === "off" ? (
        <ConversationSelectionFields
          channel={place.observedChannel}
          accountId={place.accountId}
          // A group-chat Rule: DMs are the other kind of Rule.
          excludeKind="dm"
          value={where.conversations}
          onChange={changeConversations}
          disabled={disabled}
          hint="Rooms, groups, threads or topics. A thread or topic narrows to it."
          placeholder="C0123, C0456"
        />
      ) : null}
      {visibilityFilterMatchesNothing(where, place.reportsVisibility) ? (
        <Alert
          variant="warning"
          title={`${place.channelName} does not report whether a chat is public or private`}
          description="This choice matches nothing here. Choose Every chat the bot is in, or pick chats."
        />
      ) : null}
      {extra.length > 0 ? (
        <Alert
          variant="info"
          title={`Also saved: ${extra.map((id) => names.conversationLabel(id)).join(", ")}`}
          description="Saved by an earlier editor. Choosing an option above replaces them."
        />
      ) : null}
    </>
  );
}
