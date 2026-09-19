// The audience-rules half of the Route editor: a list of "[who] may talk in
// [where]" rows above what the bot does (docs/audits/2026-09-19-route-audience-rules.md).
// Every row edits one `AudienceRuleDraft`; the pure module owns the shape.

import React, { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { channelCatalogEntry, channelCatalogLabel } from "../channel-catalog";
import { HUB_AUDIENCE_ROLES, type HubAudienceRole } from "../contracts";
import { useChannelCatalog } from "./channel-catalog-queries";
import { ChoiceRow, RouteBehaviorSwitch } from "./channel-route-behavior-rows";
import { splitConversationIds } from "../conversation-picker";
import {
  AUDIENCE_ROLE_LABELS,
  audienceRuleSentence,
  audienceWhereLabel,
  audienceWhoLabel,
  channelReportsVisibility,
  emptyAudienceRule,
  hasWherePart,
  hasWhoPart,
  visibilityFilterMatchesNothing,
  type AudienceGroups,
  type AudienceNames,
  type AudienceRuleDraft,
} from "./channel-route-audience";
import { ChannelActionsMenu } from "./channel-actions-menu";
import { ConversationSelectionFields, SenderSelectionFields } from "./conversation-picker-field";
import {
  DisclosureRow,
  OptionChips,
  PickerRow,
  ToggleChip,
  toggled,
  type AudienceOption,
} from "./channel-route-audience-controls";
import { MultiSelectField, type MultiSelection } from "./multi-select-field";
import type { SelectFieldOption } from "@/components/ui/select-field";

export type { AudienceOption };

export interface AudienceRulesEditorProps {
  rules: AudienceRuleDraft[];
  setRules: Dispatch<SetStateAction<AudienceRuleDraft[]>>;
  teams: readonly AudienceOption[];
  /** Members by membership id. */
  members: readonly AudienceOption[];
  /** The account's channel: decides whether the public/private filter is offered. */
  channel: string | null;
  /** The account the conversation and sender pickers read. */
  observedChannel: string | null;
  accountId: string | null;
  names: AudienceNames;
  /** Hub validation messages by rule index (`audienceRuleErrors`). */
  errors: ReadonlyMap<number, string>;
  disabled: boolean;
}

export const OPEN_AUDIENCE_WARNING = {
  title: "Anyone in the matching conversations can use this Route",
  description:
    "They can talk to the Agent this Route runs, with the settings below. This does not give them Paseo, Host or Project access. The Hub warns about wide choices after you save.",
};

export function AudienceRulesEditor({
  rules,
  setRules,
  teams,
  members,
  channel,
  observedChannel,
  accountId,
  names,
  errors,
  disabled,
}: AudienceRulesEditorProps) {
  // One rule open at a time, so the one being configured has the focus. A lone
  // rule starts open; a new rule opens and folds the others to their summary.
  const [openRuleId, setOpenRuleId] = useState<string | null>(() =>
    rules.length === 1 ? (rules[0]?.id ?? null) : null,
  );
  const addRule = useCallback(() => {
    const rule = emptyAudienceRule();
    setRules((current) => [...current, rule]);
    setOpenRuleId(rule.id);
  }, [setRules]);
  const toggleRule = useCallback(
    (id: string) => setOpenRuleId((current) => (current === id ? null : id)),
    [],
  );
  const updateRule = useCallback(
    (index: number, update: (rule: AudienceRuleDraft) => AudienceRuleDraft) =>
      setRules((current) => current.map((rule, at) => (at === index ? update(rule) : rule))),
    [setRules],
  );
  const removeRule = useCallback(
    (index: number) => setRules((current) => current.filter((_, at) => at !== index)),
    [setRules],
  );
  const catalog = useChannelCatalog();
  const place = useMemo<AudiencePlace>(
    () => ({
      channel,
      channelName:
        channel === null ? "This channel" : channelCatalogLabel(catalog.entries, channel),
      reportsVisibility: channelReportsVisibility(
        channel === null ? undefined : channelCatalogEntry(catalog.entries, channel),
      ),
      observedChannel,
      accountId,
    }),
    [accountId, catalog.entries, channel, observedChannel],
  );
  return (
    <View style={styles.editor}>
      {rules.map((rule, index) => (
        <AudienceRuleRow
          key={rule.id}
          index={index}
          rule={rule}
          teams={teams}
          members={members}
          place={place}
          names={names}
          error={errors.get(index) ?? null}
          open={openRuleId === rule.id}
          toggle={toggleRule}
          removable={rules.length > 1}
          disabled={disabled}
          update={updateRule}
          remove={removeRule}
        />
      ))}
      <View style={styles.actions}>
        <Button size="sm" variant="outline" disabled={disabled} onPress={addRule}>
          Add rule
        </Button>
      </View>
    </View>
  );
}

/** What the rows need to know about the account the Route belongs to. */
interface AudiencePlace {
  channel: string | null;
  channelName: string;
  reportsVisibility: boolean;
  observedChannel: string | null;
  accountId: string | null;
}

/**
 * One rule reads as its sentence ("Members may talk in DMs"), then the two
 * halves that make it: Who, then Where.
 */
function AudienceRuleRow({
  index,
  rule,
  teams,
  members,
  place,
  names,
  error,
  open,
  toggle,
  removable,
  disabled,
  update,
  remove,
}: {
  index: number;
  rule: AudienceRuleDraft;
  teams: readonly AudienceOption[];
  members: readonly AudienceOption[];
  place: AudiencePlace;
  names: AudienceNames;
  error: string | null;
  open: boolean;
  toggle(id: string): void;
  removable: boolean;
  disabled: boolean;
  update(index: number, update: (rule: AudienceRuleDraft) => AudienceRuleDraft): void;
  remove(index: number): void;
}) {
  const toggleOpen = useCallback(() => toggle(rule.id), [rule.id, toggle]);
  const setWho = useCallback(
    (patch: Partial<AudienceRuleDraft["who"]>) =>
      update(index, (current) => ({ ...current, who: { ...current.who, ...patch } })),
    [index, update],
  );
  const setWhere = useCallback(
    (patch: Partial<AudienceRuleDraft["where"]>) =>
      update(index, (current) => ({ ...current, where: { ...current.where, ...patch } })),
    [index, update],
  );
  const removeRow = useCallback(() => remove(index), [index, remove]);
  const label = `Rule ${String(index + 1)}`;
  const state = useMemo(() => ({ expanded: open }), [open]);
  return (
    <View style={styles.rule} accessibilityLabel={label}>
      <View style={styles.ruleHeader}>
        <Text style={styles.ruleTitle}>{label}</Text>
        <View style={styles.actions}>
          <Button
            size="xs"
            variant="ghost"
            onPress={toggleOpen}
            accessibilityState={state}
            accessibilityLabel={`${open ? "Collapse" : "Edit"} ${label}`}
          >
            {open ? "Done" : "Edit"}
          </Button>
          {removable ? (
            // Behind the menu, so a press meant for Edit never removes a rule.
            <ChannelActionsMenu
              label={`Actions for ${label}`}
              disabled={disabled}
              remove={removeRow}
            />
          ) : null}
        </View>
      </View>
      {open ? (
        <>
          <Text style={settingsStyles.rowHint}>{audienceRuleSentence(rule, names)}</Text>
          <AudienceWhoFields
            who={rule.who}
            teams={teams}
            members={members}
            place={place}
            disabled={disabled}
            setWho={setWho}
          />
          <AudienceWhereFields
            where={rule.where}
            place={place}
            disabled={disabled}
            setWhere={setWhere}
          />
        </>
      ) : (
        <AudienceRuleSummary rule={rule} names={names} />
      )}
      {error === null ? null : <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

/** A folded rule: the same Who and Where, one line each. */
function AudienceRuleSummary({ rule, names }: { rule: AudienceRuleDraft; names: AudienceNames }) {
  const complete = hasWhoPart(rule.who) && hasWherePart(rule.where);
  return (
    <View style={styles.summary}>
      <SummaryLine label="Who" value={audienceWhoLabel(rule.who, names)} />
      <SummaryLine label="Where" value={audienceWhereLabel(rule.where, names)} />
      {complete ? null : (
        <Text style={styles.errorText}>Choose both a Who and a Where to save.</Text>
      )}
    </View>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

type WhoScope = "hub" | "anyone";
const WHO_SCOPE_VALUES: WhoScope[] = ["hub", "anyone"];
const WHO_SCOPE_LABELS: Record<WhoScope, string> = {
  hub: "People you choose",
  anyone: "Anyone in the conversation",
};

/**
 * Who, as one choice first: people you choose, or anyone in the conversation.
 * Anyone covers everyone, so the people rows only show for the first.
 */
function AudienceWhoFields({
  who,
  teams,
  members,
  place,
  disabled,
  setWho,
}: {
  who: AudienceRuleDraft["who"];
  teams: readonly AudienceOption[];
  members: readonly AudienceOption[];
  place: AudiencePlace;
  disabled: boolean;
  setWho(patch: Partial<AudienceRuleDraft["who"]>): void;
}) {
  const changeScope = useCallback(
    (value: string) => setWho({ anyone: value === "anyone" }),
    [setWho],
  );
  return (
    <View style={styles.part}>
      <ChoiceRow
        label="Who"
        values={WHO_SCOPE_VALUES}
        selected={who.anyone ? "anyone" : "hub"}
        labels={WHO_SCOPE_LABELS}
        onChange={changeScope}
        disabled={disabled}
      />
      {who.anyone ? (
        <Alert
          variant="warning"
          title={OPEN_AUDIENCE_WARNING.title}
          description={OPEN_AUDIENCE_WARNING.description}
        />
      ) : (
        <AudiencePeopleFields
          who={who}
          teams={teams}
          members={members}
          place={place}
          disabled={disabled}
          setWho={setWho}
        />
      )}
    </View>
  );
}

const TEAM_PREFIX = "team:";
const MEMBER_PREFIX = "member:";

/** Teams, then Members, in one list: the same picker Access uses for a grant. */
function teamAndMemberOptions(
  teams: readonly AudienceOption[],
  members: readonly AudienceOption[],
): SelectFieldOption<string>[] {
  return [
    ...teams.map((team) => ({
      id: `${TEAM_PREFIX}${team.id}`,
      value: `${TEAM_PREFIX}${team.id}`,
      label: team.name,
      group: "Teams",
    })),
    ...members.map((member) => ({
      id: `${MEMBER_PREFIX}${member.id}`,
      value: `${MEMBER_PREFIX}${member.id}`,
      label: member.name,
      group: "Members",
    })),
  ];
}

/**
 * The people a rule names: by role, by Team or Member, or by their channel id
 * when they have no Hub account to match on.
 */
function AudiencePeopleFields({
  who,
  teams,
  members,
  place,
  disabled,
  setWho,
}: {
  who: AudienceRuleDraft["who"];
  teams: readonly AudienceOption[];
  members: readonly AudienceOption[];
  place: AudiencePlace;
  disabled: boolean;
  setWho(patch: Partial<AudienceRuleDraft["who"]>): void;
}) {
  const toggleRole = useCallback(
    (role: string) => setWho({ roles: toggled(who.roles, role as HubAudienceRole) }),
    [setWho, who.roles],
  );
  const peopleOptions = useMemo(() => teamAndMemberOptions(teams, members), [members, teams]);
  const people = useMemo(
    () => [
      ...who.teams.map((id) => `${TEAM_PREFIX}${id}`),
      ...who.members.map((id) => `${MEMBER_PREFIX}${id}`),
    ],
    [who.members, who.teams],
  );
  const changePeople = useCallback(
    (value: MultiSelection) => {
      const ids = value === "*" ? [] : value;
      setWho({
        teams: ids
          .filter((id) => id.startsWith(TEAM_PREFIX))
          .map((id) => id.slice(TEAM_PREFIX.length)),
        members: ids
          .filter((id) => id.startsWith(MEMBER_PREFIX))
          .map((id) => id.slice(MEMBER_PREFIX.length)),
      });
    },
    [setWho],
  );
  const changeIdentities = useCallback((identities: string) => setWho({ identities }), [setWho]);
  const roleOptions = useMemo(
    () => HUB_AUDIENCE_ROLES.map((role) => ({ id: role, name: AUDIENCE_ROLE_LABELS[role] })),
    [],
  );
  return (
    <View style={styles.nested}>
      <PickerRow label="Roles">
        <OptionChips
          options={roleOptions}
          selected={who.roles}
          disabled={disabled}
          onToggle={toggleRole}
          empty=""
        />
      </PickerRow>
      <MultiSelectField
        label="Teams and Members"
        options={peopleOptions}
        value={people}
        onChange={changePeople}
        disabled={disabled}
        placeholder="Choose Teams or Members"
        searchPlaceholder="Search Teams and Members"
      />
      <DisclosureRow
        label={`${place.channelName} users without a Hub account`}
        count={splitConversationIds(who.identities).length}
        disabled={disabled}
      >
        <SenderSelectionFields
          channel={place.observedChannel}
          accountId={place.accountId}
          value={who.identities}
          onChange={changeIdentities}
          disabled={disabled}
        />
      </DisclosureRow>
    </View>
  );
}

const GROUP_FILTER_VALUES: readonly Exclude<AudienceGroups, "off">[] = ["all", "public", "private"];
const GROUP_FILTER_LABELS: Record<Exclude<AudienceGroups, "off">, string> = {
  all: "All",
  public: "Public only",
  private: "Private only",
};

/** Where, as three places of the same kind: DMs, group chats, named conversations. */
function AudienceWhereFields({
  where,
  place,
  disabled,
  setWhere,
}: {
  where: AudienceRuleDraft["where"];
  place: AudiencePlace;
  disabled: boolean;
  setWhere(patch: Partial<AudienceRuleDraft["where"]>): void;
}) {
  const changeDm = useCallback((dm: boolean) => setWhere({ dm }), [setWhere]);
  const changeGroups = useCallback(
    (on: boolean) => setWhere({ groups: on ? "all" : "off" }),
    [setWhere],
  );
  const changeFilter = useCallback(
    (value: string) => setWhere({ groups: value as AudienceGroups }),
    [setWhere],
  );
  const changeConversations = useCallback(
    (conversations: string) => setWhere({ conversations }),
    [setWhere],
  );
  // A stored public/private filter stays editable where it matches nothing.
  const filtered = where.groups === "public" || where.groups === "private";
  return (
    <View style={styles.part}>
      <Text style={styles.label}>Where</Text>
      <View style={styles.nested}>
        <RouteBehaviorSwitch
          label="Direct messages"
          value={where.dm}
          onChange={changeDm}
          disabled={disabled}
        />
        <RouteBehaviorSwitch
          label="Group chats"
          value={where.groups !== "off"}
          onChange={changeGroups}
          disabled={disabled}
        />
        {where.groups !== "off" && (place.reportsVisibility || filtered) ? (
          <View style={styles.chips}>
            {GROUP_FILTER_VALUES.map((value) => (
              <ToggleChip
                key={value}
                value={value}
                label={GROUP_FILTER_LABELS[value]}
                selected={where.groups === value}
                disabled={disabled}
                onToggle={changeFilter}
              />
            ))}
          </View>
        ) : null}
        {visibilityFilterMatchesNothing(where, place.reportsVisibility) ? (
          <Alert
            variant="warning"
            title={`${place.channelName} does not report whether a group chat is public or private`}
            description="This filter matches no group chat here. Choose All, or name the conversations under Specific conversations."
          />
        ) : null}
        <DisclosureRow
          label="Specific conversations"
          count={splitConversationIds(where.conversations).length}
          disabled={disabled}
        >
          <ConversationSelectionFields
            channel={place.observedChannel}
            accountId={place.accountId}
            value={where.conversations}
            onChange={changeConversations}
            disabled={disabled}
            hint="Named rooms, groups, threads or topics, whatever their visibility. A thread or topic narrows to it."
            placeholder="C0123, C0456"
          />
        </DisclosureRow>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  editor: { gap: theme.spacing[3] },
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
  summary: { gap: theme.spacing[1] },
  summaryLine: { flexDirection: "row", gap: theme.spacing[3] },
  // Base size, like the fields it folds: a summary is read, not skimmed past.
  summaryLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    width: 64,
  },
  summaryValue: {
    color: theme.colors.foreground,
    flex: 1,
    fontSize: theme.fontSize.base,
  },
  nested: { gap: theme.spacing[3], paddingLeft: theme.spacing[3] },
  ruleTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  part: { gap: theme.spacing[2] },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
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
