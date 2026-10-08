// The Route form's Rules section: each Rule is one way into the Route — where,
// who, and when a message gets in (docs/audits/2026-10-05-routes-and-rules.md).
// Every row edits one `AudienceRuleDraft`; the pure module owns the shape.

import { Plus } from "lucide-react-native";
import React, { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { channelCatalogEntry, channelCatalogLabel } from "../channel-catalog";
import { useChannelCatalog } from "./channel-catalog-queries";
import { ChannelActionsMenu } from "./channel-actions-menu";
import {
  ruleProblemAt,
  type RuleProblemPart,
  channelReportsVisibility,
  newAudienceRule,
  type AudienceRuleDraft,
  type InheritedConditions,
} from "./channel-route-audience";
import type { AudienceOption } from "./channel-route-audience-controls";
import { RuleWhereFields, type AudienceWherePlace } from "./channel-route-audience-where";
import { RuleConditionFields } from "./channel-route-rule-conditions";
import { RuleLimitFields } from "./channel-route-rule-limits";
import type { ChannelLimits } from "../channel-configuration";
import type { RulePeople } from "./channel-route-rule-people";
import { ruleSummary, type AudienceNames } from "./channel-route-rule-summary";
import { RuleWhoFields } from "./channel-route-rule-who";

export type { AudienceOption };
export { openAudienceWarning } from "./channel-route-rule-who";

interface AudienceRulesEditorProps {
  rules: AudienceRuleDraft[];
  setRules: Dispatch<SetStateAction<AudienceRuleDraft[]>>;
  people: RulePeople;
  /** The account's channel: names the channel and decides the public/private choices. */
  channel: string | null;
  /** The account the conversation and sender pickers read. */
  observedChannel: string | null;
  accountId: string | null;
  names: AudienceNames;
  /** What a Rule meets for a condition it does not set. */
  inherited: InheritedConditions;
  /** The Route's own limits: what a Rule's unset limit meets first. */
  routeLimits: ChannelLimits;
  /** Hub validation messages by rule index (`audienceRuleErrors`). */
  errors: ReadonlyMap<number, string>;
  disabled: boolean;
}

/** One Rule's changes, whatever part of it they touch. */
type Update = (change: (rule: AudienceRuleDraft) => AudienceRuleDraft) => void;

export function AudienceRulesEditor(props: AudienceRulesEditorProps) {
  const { rules, setRules, disabled } = props;
  const { t } = useTranslation();
  // A lone Rule is the Route's only way in, so it is always open. From two
  // Rules on, one is open at a time: a new Rule opens and folds the others.
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);
  const addRule = useCallback(() => {
    // A Route that already takes DMs most likely needs group chats next.
    const rule = newAudienceRule(rules.some(({ place }) => place === "dm") ? "groups" : "dm");
    setRules((current) => [...current, rule]);
    setOpenRuleId(rule.id);
  }, [rules, setRules]);
  const toggleRule = useCallback(
    (id: string) => setOpenRuleId((current) => (current === id ? null : id)),
    [],
  );
  const updateRule = useCallback(
    (index: number, change: (rule: AudienceRuleDraft) => AudienceRuleDraft) =>
      setRules((current) =>
        current.map((rule, at) => (at === index ? { ...change(rule), edited: true } : rule)),
      ),
    [setRules],
  );
  const removeRule = useCallback(
    (index: number) => setRules((current) => current.filter((_, at) => at !== index)),
    [setRules],
  );
  const place = useRulePlace(props);
  return (
    <View style={styles.editor}>
      {rules.map((rule, index) => (
        <AudienceRuleRow
          key={rule.id}
          index={index}
          framed={rules.length > 1}
          rule={rule}
          open={rules.length === 1 || openRuleId === rule.id}
          toggle={toggleRule}
          place={place}
          editor={props}
          error={props.errors.get(index) ?? null}
          update={updateRule}
          remove={removeRule}
        />
      ))}
      {/* Secondary and worded as "another", so it never reads as the way to
          finish the rule above it. */}
      <View style={styles.addRule}>
        <Button size="sm" variant="ghost" leftIcon={Plus} disabled={disabled} onPress={addRule}>
          {t("hub.routes.rules.addAnother")}
        </Button>
      </View>
    </View>
  );
}

/** What every Rule needs to know about the account the Route belongs to. */
function useRulePlace({ channel, observedChannel, accountId }: AudienceRulesEditorProps) {
  const catalog = useChannelCatalog();
  const { t } = useTranslation();
  return useMemo<AudienceWherePlace>(
    () => ({
      channelName:
        channel === null
          ? t("hub.routes.common.theChannel")
          : channelCatalogLabel(catalog.entries, channel),
      reportsVisibility: channelReportsVisibility(
        channel === null ? undefined : channelCatalogEntry(catalog.entries, channel),
      ),
      observedChannel,
      accountId,
    }),
    [accountId, catalog.entries, channel, observedChannel, t],
  );
}

/** One Rule: unframed when it is the only one; otherwise titled, foldable and removable. */
function AudienceRuleRow({
  index,
  framed,
  rule,
  open,
  toggle,
  place,
  editor,
  error,
  update,
  remove,
}: {
  index: number;
  framed: boolean;
  rule: AudienceRuleDraft;
  open: boolean;
  toggle(id: string): void;
  place: AudienceWherePlace;
  editor: AudienceRulesEditorProps;
  error: string | null;
  update(index: number, change: (rule: AudienceRuleDraft) => AudienceRuleDraft): void;
  remove(index: number): void;
}) {
  const { t } = useTranslation();
  const updateThis = useCallback<Update>((change) => update(index, change), [index, update]);
  const problem = ruleProblemAt(rule, editor.inherited);
  // An open Rule shows a Where or Who problem under that field; the rest, and
  // every problem of a folded Rule, under the Rule.
  const below =
    problem !== null && (!open || problem.part === "conditions") ? problem.message : null;
  return (
    <View
      style={framed ? styles.rule : styles.loneRule}
      accessibilityLabel={t("hub.routes.rules.rule", { number: index + 1 })}
    >
      {framed ? (
        <RuleHeader
          index={index}
          rule={rule}
          open={open}
          toggle={toggle}
          remove={remove}
          disabled={editor.disabled}
        />
      ) : null}
      {open ? (
        <RuleBody rule={rule} place={place} editor={editor} update={updateThis} problem={problem} />
      ) : (
        <Text style={styles.summary}>{ruleSummary(rule, editor.names, editor.inherited)}</Text>
      )}
      {below === null ? null : <Text style={styles.errorText}>{below}</Text>}
      {error === null ? null : <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

function RuleHeader({
  index,
  rule,
  open,
  toggle,
  remove,
  disabled,
}: {
  index: number;
  rule: AudienceRuleDraft;
  open: boolean;
  toggle(id: string): void;
  remove(index: number): void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const number = index + 1;
  const toggleOpen = useCallback(() => toggle(rule.id), [rule.id, toggle]);
  const removeRow = useCallback(() => remove(index), [index, remove]);
  const state = useMemo(() => ({ expanded: open }), [open]);
  return (
    <View style={styles.ruleHeader}>
      <Text style={styles.ruleTitle}>{t("hub.routes.rules.rule", { number })}</Text>
      <View style={styles.actions}>
        <Button
          size="xs"
          variant="ghost"
          onPress={toggleOpen}
          accessibilityState={state}
          accessibilityLabel={
            open
              ? t("hub.routes.rules.collapse", { number })
              : t("hub.routes.rules.edit", { number })
          }
        >
          {open ? t("hub.routes.common.hide") : t("hub.routes.common.edit")}
        </Button>
        {/* Behind the menu, so a press meant for Edit never removes a rule. */}
        <ChannelActionsMenu
          label={t("hub.routes.rules.actions", { number })}
          disabled={disabled}
          remove={removeRow}
        />
      </View>
    </View>
  );
}

function RuleBody({
  rule,
  place,
  editor,
  update,
  problem,
}: {
  rule: AudienceRuleDraft;
  place: AudienceWherePlace;
  editor: AudienceRulesEditorProps;
  update: Update;
  problem: { part: RuleProblemPart; message: string } | null;
}) {
  const at = (part: RuleProblemPart) => (problem?.part === part ? problem.message : null);
  return (
    <>
      <RuleWhereFields
        rule={rule}
        place={place}
        names={editor.names}
        disabled={editor.disabled}
        update={update}
        problem={at("where")}
      />
      <RuleWhoFields
        rule={rule}
        people={editor.people}
        place={place}
        names={editor.names}
        disabled={editor.disabled}
        update={update}
        problem={at("who")}
      />
      <RuleConditionFields
        rule={rule}
        inherited={editor.inherited}
        disabled={editor.disabled}
        update={update}
      />
      <RuleLimitFields
        rule={rule}
        routeLimits={editor.routeLimits}
        disabled={editor.disabled}
        update={update}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  editor: { gap: theme.spacing[3] },
  loneRule: { gap: theme.spacing[3] },
  // Pulled left by the button's own padding and border, so its + sits on the
  // fields' left edge.
  addRule: { alignItems: "flex-start", marginLeft: -(theme.spacing[3] + 1) },
  rule: {
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  ruleHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  ruleTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  summary: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
