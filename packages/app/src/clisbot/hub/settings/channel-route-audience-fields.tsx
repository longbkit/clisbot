// The audience-rules half of the Route editor: a list of "[who] may talk in
// [where]" rows above what the bot does (docs/audits/2026-09-19-route-audience-rules.md).
// Every row edits one `AudienceRuleDraft`; the pure module owns the shape.

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { channelCatalogEntry, channelCatalogLabel } from "../channel-catalog";
import { HUB_AUDIENCE_ROLES, type HubAudienceRole } from "../contracts";
import { useChannelCatalog } from "./channel-catalog-queries";
import { RouteBehaviorSwitch } from "./channel-route-behavior-rows";
import {
  AUDIENCE_ROLE_LABELS,
  audienceRuleSentence,
  channelReportsVisibility,
  emptyAudienceRule,
  routeAudienceSummary,
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
  const summary = useMemo(() => routeAudienceSummary(rules, names), [rules, names]);
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
      <RouteAudienceSummary summary={summary} />
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
        <Text style={styles.ruleTitle}>{label}</Text>
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
      <Text style={settingsStyles.rowHint}>{audienceRuleSentence(rule, names)}</Text>
      {error === null ? null : <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

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
  const [showTeams, setShowTeams] = useState(who.teams.length > 0);
  const [showMembers, setShowMembers] = useState(who.members.length > 0);
  const [showAdvanced, setShowAdvanced] = useState(who.identities.length > 0);
  const toggleTeams = useCallback(() => setShowTeams((value) => !value), []);
  const toggleMembers = useCallback(() => setShowMembers((value) => !value), []);
  const toggleAdvanced = useCallback(() => setShowAdvanced((value) => !value), []);
  const toggleRole = useCallback(
    (role: string) => setWho({ roles: toggled(who.roles, role as HubAudienceRole) }),
    [setWho, who.roles],
  );
  const toggleAnyone = useCallback(() => setWho({ anyone: !who.anyone }), [setWho, who.anyone]);
  const toggleTeam = useCallback(
    (id: string) => setWho({ teams: toggled(who.teams, id) }),
    [setWho, who.teams],
  );
  const toggleMember = useCallback(
    (id: string) => setWho({ members: toggled(who.members, id) }),
    [setWho, who.members],
  );
  const changeIdentities = useCallback((identities: string) => setWho({ identities }), [setWho]);
  return (
    <View style={styles.part}>
      <Text style={styles.label}>Who</Text>
      <View style={styles.chips}>
        {HUB_AUDIENCE_ROLES.map((role) => (
          <ToggleChip
            key={role}
            value={role}
            label={AUDIENCE_ROLE_LABELS[role]}
            selected={who.roles.includes(role)}
            disabled={disabled}
            onToggle={toggleRole}
          />
        ))}
        {teams.length === 0 ? null : (
          <DisclosureChip
            label="Teams…"
            open={showTeams}
            count={who.teams.length}
            disabled={disabled}
            onPress={toggleTeams}
          />
        )}
        <DisclosureChip
          label="Members…"
          open={showMembers}
          count={who.members.length}
          disabled={disabled}
          onPress={toggleMembers}
        />
        <ToggleChip
          value="anyone"
          label="Anyone"
          selected={who.anyone}
          disabled={disabled}
          onToggle={toggleAnyone}
        />
      </View>
      {showTeams ? (
        <OptionChips
          options={teams}
          selected={who.teams}
          disabled={disabled}
          onToggle={toggleTeam}
          empty="No Teams yet."
        />
      ) : null}
      {showMembers ? (
        <OptionChips
          options={members}
          selected={who.members}
          disabled={disabled}
          onToggle={toggleMember}
          empty="No Members yet."
        />
      ) : null}
      {who.anyone ? (
        <Alert
          variant="warning"
          title={OPEN_AUDIENCE_WARNING.title}
          description={OPEN_AUDIENCE_WARNING.description}
        />
      ) : null}
      <Button size="xs" variant="ghost" disabled={disabled} onPress={toggleAdvanced}>
        {showAdvanced ? "Hide senders outside the Hub" : "Advanced: senders outside the Hub"}
      </Button>
      {showAdvanced ? (
        <SenderSelectionFields
          channel={place.observedChannel}
          accountId={place.accountId}
          value={who.identities}
          onChange={changeIdentities}
          disabled={disabled}
        />
      ) : null}
    </View>
  );
}

const GROUP_FILTER_VALUES: readonly Exclude<AudienceGroups, "off">[] = ["all", "public", "private"];
const GROUP_FILTER_LABELS: Record<Exclude<AudienceGroups, "off">, string> = {
  all: "All",
  public: "Public only",
  private: "Private only",
};

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
  const [showSpecific, setShowSpecific] = useState(where.conversations.length > 0);
  const toggleSpecific = useCallback(() => setShowSpecific((value) => !value), []);
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
      <RouteBehaviorSwitch label="DM" value={where.dm} onChange={changeDm} disabled={disabled} />
      <RouteBehaviorSwitch
        label="Group chat"
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
      <Button size="xs" variant="ghost" disabled={disabled} onPress={toggleSpecific}>
        {showSpecific ? "Hide specific conversations" : "Specific conversations…"}
      </Button>
      {showSpecific ? (
        <ConversationSelectionFields
          channel={place.observedChannel}
          accountId={place.accountId}
          value={where.conversations}
          onChange={changeConversations}
          disabled={disabled}
          hint="Named rooms, groups, threads or topics, whatever their visibility. A thread or topic narrows to it."
          placeholder="C0123, C0456"
        />
      ) : null}
    </View>
  );
}

function RouteAudienceSummary({ summary }: { summary: { place: string; who: string }[] }) {
  if (summary.length === 0) return null;
  return (
    <View style={styles.summary}>
      {summary.map(({ place, who }) => (
        <View key={place} style={styles.summaryLine}>
          <Text style={styles.summaryPlace}>{place}</Text>
          <Text style={styles.summaryWho}>{who}</Text>
        </View>
      ))}
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

function DisclosureChip({
  label,
  open,
  count,
  disabled,
  onPress,
}: {
  label: string;
  open: boolean;
  count: number;
  disabled: boolean;
  onPress(): void;
}) {
  const state = useMemo(() => ({ expanded: open }), [open]);
  return (
    <Button
      size="xs"
      variant={count > 0 ? "secondary" : "outline"}
      disabled={disabled}
      onPress={onPress}
      accessibilityState={state}
    >
      {count > 0 ? `${label} (${String(count)})` : label}
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
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
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
  summary: { gap: theme.spacing[1] },
  summaryLine: {
    alignItems: "baseline",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  summaryPlace: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  summaryWho: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
