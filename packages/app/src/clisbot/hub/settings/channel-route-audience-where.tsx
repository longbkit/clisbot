// Where one Rule applies: direct messages, or group chats — and for group
// chats, which ones. One kind of place per Rule, so each Rule reads as one
// way in (docs/audits/2026-10-05-routes-and-rules.md).

import type { TFunction } from "i18next";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
function placeLabels(t: TFunction): Record<RulePlace, string> {
  return { dm: t("hub.routes.where.places.dm"), groups: t("hub.routes.where.places.groups") };
}

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
  const { t } = useTranslation();
  const changePlace = useCallback(
    (value: string) => update((current) => withPlace(current, value as RulePlace)),
    [update],
  );
  return (
    <>
      <ChoiceRow
        label={t("hub.routes.where.label")}
        values={PLACES}
        selected={rule.place}
        labels={placeLabels(t)}
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

function scopeLabels(t: TFunction): Record<Exclude<AudienceGroupScope, "off">, string> {
  return {
    specific: t("hub.routes.groupScopes.specific"),
    all: t("hub.routes.groupScopes.all"),
    public: t("hub.routes.groupScopes.public"),
    private: t("hub.routes.groupScopes.private"),
  };
}

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
  const { t } = useTranslation();
  const { where } = rule;
  // A stored public/private filter stays selectable where it matches nothing.
  const filtered = where.groups === "public" || where.groups === "private";
  const scopes = useMemo<RadioOption<Exclude<AudienceGroupScope, "off">>[]>(
    () =>
      (place.reportsVisibility || filtered
        ? (["specific", "all", "public", "private"] as const)
        : (["specific", "all"] as const)
      ).map((value) => ({ value, label: scopeLabels(t)[value] })),
    [filtered, place.reportsVisibility, t],
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
        label={t("hub.routes.where.whichChats")}
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
          hint={t("hub.routes.where.chatsHint")}
          placeholder="C0123, C0456"
        />
      ) : null}
      {visibilityFilterMatchesNothing(where, place.reportsVisibility) ? (
        <Alert
          variant="warning"
          title={t("hub.routes.where.noVisibilityTitle", { channel: place.channelName })}
          description={t("hub.routes.where.noVisibilityDescription")}
        />
      ) : null}
      {extra.length > 0 ? (
        <Alert
          variant="info"
          title={t("hub.routes.where.alsoSavedTitle", {
            chats: extra
              .map((id) => names.conversationLabel(id))
              .join(t("hub.routes.common.listSeparator")),
          })}
          description={t("hub.routes.where.alsoSavedDescription")}
        />
      ) : null}
    </>
  );
}
