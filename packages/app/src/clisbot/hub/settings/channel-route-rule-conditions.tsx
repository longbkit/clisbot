// When a message gets in through one Rule: a mention, how an unmentioned
// follow-up continues, and the text it must contain. A leaf the Rule does not
// set shows what it inherits and writes nothing until it is changed.

import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Field, FormTextInput } from "@/components/ui/form-field";
import {
  effectiveConditions,
  type AudienceRuleDraft,
  type InheritedConditions,
} from "./channel-route-audience";
import { RouteBehaviorSwitch, RouteNumberRow } from "./channel-route-behavior-rows";

type Update = (change: (rule: AudienceRuleDraft) => AudienceRuleDraft) => void;

export function RuleConditionFields({
  rule,
  inherited,
  disabled,
  update,
}: {
  rule: AudienceRuleDraft;
  inherited: InheritedConditions;
  disabled: boolean;
  update: Update;
}) {
  const { t } = useTranslation();
  const effective = effectiveConditions(rule.conditions, inherited);
  const setConditions = useCallback(
    (patch: Partial<AudienceRuleDraft["conditions"]>) =>
      update((current) => ({ ...current, conditions: { ...current.conditions, ...patch } })),
    [update],
  );
  const changeMention = useCallback(
    (requireMention: boolean) => setConditions({ requireMention }),
    [setConditions],
  );
  const changeContinue = useCallback(
    (on: boolean) => setConditions({ followUpMode: on ? "auto" : "mention-only" }),
    [setConditions],
  );
  const changeMinutes = useCallback(
    (ttlMinutes: string) => setConditions({ ttlMinutes }),
    [setConditions],
  );
  return (
    <>
      <RouteBehaviorSwitch
        label={t("hub.routes.conditions.requireMention")}
        value={effective.requireMention}
        onChange={changeMention}
        disabled={disabled}
      />
      {effective.requireMention ? (
        <RouteBehaviorSwitch
          label={t("hub.routes.conditions.continueWithoutMention")}
          value={effective.followUpMode === "auto"}
          onChange={changeContinue}
          disabled={disabled}
        />
      ) : null}
      {effective.requireMention && effective.followUpMode === "auto" ? (
        <RouteNumberRow
          label={t("hub.routes.conditions.followUpMinutes")}
          unit={t("hub.routes.common.minutesUnit")}
          value={rule.conditions.ttlMinutes ?? String(effective.ttlMinutes)}
          onChange={changeMinutes}
          disabled={disabled}
        />
      ) : null}
      <RuleTextFilter rule={rule} disabled={disabled} setConditions={setConditions} />
    </>
  );
}

function RuleTextFilter({
  rule,
  disabled,
  setConditions,
}: {
  rule: AudienceRuleDraft;
  disabled: boolean;
  setConditions(patch: Partial<AudienceRuleDraft["conditions"]>): void;
}) {
  const { t } = useTranslation();
  const filtered = rule.conditions.contains !== undefined;
  const toggle = useCallback(
    (on: boolean) => setConditions({ contains: on ? "" : undefined }),
    [setConditions],
  );
  const type = useCallback((contains: string) => setConditions({ contains }), [setConditions]);
  return (
    <>
      <RouteBehaviorSwitch
        label={t("hub.routes.conditions.onlyContaining")}
        value={filtered}
        onChange={toggle}
        disabled={disabled}
      />
      {filtered ? (
        <Field label={t("hub.routes.conditions.text")} hint={t("hub.routes.conditions.textHint")}>
          <FormTextInput
            initialValue={rule.conditions.contains ?? ""}
            onChangeText={type}
            placeholder="#help"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
          />
        </Field>
      ) : null}
    </>
  );
}
