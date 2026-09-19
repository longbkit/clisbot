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
  channelReportsVisibility,
  emptyAudienceRule,
  visibilityFilterMatchesNothing,
  type AudienceGroups,
  type AudienceNames,
  type AudienceRuleDraft,
} from "./channel-route-audience";
import { ConversationSelectionFields, SenderSelectionFields } from "./conversation-picker-field";

export interface AudienceOption {
  id: string;
  name: string;
}

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
  const addRule = useCallback(
    () => setRules((current) => [...current, emptyAudienceRule()]),
    [setRules],
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
  removable: boolean;
  disabled: boolean;
  update(index: number, update: (rule: AudienceRuleDraft) => AudienceRuleDraft): void;
  remove(index: number): void;
}) {
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
  return (
    <View style={styles.rule} accessibilityLabel={label}>
      <View style={styles.ruleHeader}>
        <View style={styles.ruleHeading}>
          <Text style={styles.ruleTitle}>{label}</Text>
          <Text style={settingsStyles.rowHint}>{audienceRuleSentence(rule, names)}</Text>
        </View>
        {removable ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            onPress={removeRow}
            accessibilityLabel={`Remove ${label}`}
          >
            Remove
          </Button>
        ) : null}
      </View>
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
      {error === null ? null : <Text style={styles.errorText}>{error}</Text>}
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

/** The people a rule names: by role, Team, Member, or a sender outside the Hub. */
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
  const toggleTeam = useCallback(
    (id: string) => setWho({ teams: toggled(who.teams, id) }),
    [setWho, who.teams],
  );
  const toggleMember = useCallback(
    (id: string) => setWho({ members: toggled(who.members, id) }),
    [setWho, who.members],
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
      {teams.length === 0 ? null : (
        <DisclosureRow label="Teams" count={who.teams.length} disabled={disabled}>
          <OptionChips
            options={teams}
            selected={who.teams}
            disabled={disabled}
            onToggle={toggleTeam}
            empty="No Teams yet."
          />
        </DisclosureRow>
      )}
      <DisclosureRow label="Specific Members" count={who.members.length} disabled={disabled}>
        <OptionChips
          options={members}
          selected={who.members}
          disabled={disabled}
          onToggle={toggleMember}
          empty="No Members yet."
        />
      </DisclosureRow>
      <DisclosureRow
        label="Senders outside the Hub"
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

/** A labelled row whose control sits under the label. */
function PickerRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.part}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

/** A labelled row folded to its count; it opens on its own when it holds a value. */
function DisclosureRow({
  label,
  count,
  disabled,
  children,
}: {
  label: string;
  count: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(count > 0);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const state = useMemo(() => ({ expanded: open }), [open]);
  return (
    <View style={styles.part}>
      <View style={styles.disclosureHeader}>
        <Text style={styles.rowLabel}>{count > 0 ? `${label} (${String(count)})` : label}</Text>
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled}
          onPress={toggle}
          accessibilityState={state}
          accessibilityLabel={`${open ? "Hide" : "Choose"} ${label}`}
        >
          {open ? "Hide" : "Choose"}
        </Button>
      </View>
      {open ? children : null}
    </View>
  );
}

function OptionChips({
  options,
  selected,
  disabled,
  onToggle,
  empty,
}: {
  options: readonly AudienceOption[];
  selected: readonly string[];
  disabled: boolean;
  onToggle(id: string): void;
  empty: string;
}) {
  if (options.length === 0) return <Text style={settingsStyles.rowHint}>{empty}</Text>;
  return (
    <View style={styles.chips}>
      {options.map((option) => (
        <ToggleChip
          key={option.id}
          value={option.id}
          label={option.name}
          selected={selected.includes(option.id)}
          disabled={disabled}
          onToggle={onToggle}
        />
      ))}
    </View>
  );
}

function ToggleChip({
  value,
  label,
  selected,
  disabled,
  onToggle,
}: {
  value: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onToggle(value: string): void;
}) {
  const press = useCallback(() => onToggle(value), [onToggle, value]);
  const state = useMemo(() => ({ selected }), [selected]);
  return (
    <Button
      size="xs"
      variant={selected ? "secondary" : "outline"}
      disabled={disabled}
      onPress={press}
      accessibilityState={state}
    >
      {label}
    </Button>
  );
}

function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
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
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  ruleHeading: { flex: 1, gap: theme.spacing[1] },
  nested: { gap: theme.spacing[3], paddingLeft: theme.spacing[3] },
  disclosureHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rowLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
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
