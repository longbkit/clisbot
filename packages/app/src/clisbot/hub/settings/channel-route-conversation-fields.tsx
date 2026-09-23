import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import {
  UNMENTIONED_VALUES,
  WHEN_BUSY_VALUES,
  type ChannelRouteUnmentioned,
  type ChannelRouteWhenBusy,
  type EffectiveChannelRouteConversation,
} from "../channel-route-conversation";
import {
  ChoiceRow,
  RouteBehaviorSwitch,
  RouteNumberRow,
  type RouteNumberRowProps,
} from "./channel-route-behavior-rows";
import {
  openRouteConversationDraft,
  parseRouteConversationDraft,
  routeConversationDisplay,
  setRouteBatchingField,
  setRouteBatchingOn,
  type BatchingFieldName,
  type ParsedRouteConversation,
  type RouteConversationDraft,
} from "./channel-route-conversation-form";
import { FoldedRouteFormSubgroup, RouteFormSection } from "./channel-route-form-sections";

// The Route form's Conversation context section
// (docs/features/channels/conversation-flow.md, "Configuration").

const CONVERSATION_CONTEXT_INFO =
  "What the Agent is given with a message. Earlier messages are the ones in the same conversation that did not start a turn since the last delivery; they are sent before the message that did.";
const UNMENTIONED_LABELS: Record<ChannelRouteUnmentioned, string> = {
  everyone: "Everyone",
  "allowed-senders": "Allowed senders only",
  none: "None",
};
// The app's own words for the same choice (Settings → General, "Default
// send"): Enter steers the running turn, Command/Ctrl+Enter queues it.
const WHEN_BUSY_LABELS: Record<ChannelRouteWhenBusy, string> = {
  steer: "Steer",
  queue: "Queue",
};
const BATCHING_ROWS: { name: BatchingFieldName; label: string; unit?: string }[] = [
  { name: "pauseSeconds", label: "Send after no new messages for", unit: "seconds" },
  { name: "maxWaitSeconds", label: "Send anyway after", unit: "seconds" },
  { name: "maxMessages", label: "Max messages per batch" },
];

export interface RouteConversationCommands {
  changeUnmentioned(value: string): void;
  changeMaxMessages(text: string): void;
  changeBatchingOn(on: boolean): void;
  changeBatchingField(name: BatchingFieldName, text: string): void;
  changeWhenBusy(value: string): void;
}

/**
 * The section's draft for one open form; `parsed.value` is what a save writes.
 * What the Route inherits follows the picked Connection, so it is an input on
 * every render, not part of the opened draft.
 */
export function useRouteConversationDraft(
  route: Record<string, unknown> | undefined,
  inherited: EffectiveChannelRouteConversation,
): {
  draft: RouteConversationDraft;
  parsed: ParsedRouteConversation;
  commands: RouteConversationCommands;
} {
  const [opened, setDraft] = useState(() => openRouteConversationDraft(route, inherited));
  const draft = useMemo(() => ({ ...opened, inherited }), [opened, inherited]);
  const parsed = useMemo(() => parseRouteConversationDraft(draft), [draft]);
  const commands = useMemo<RouteConversationCommands>(
    () => ({
      changeUnmentioned: (value) =>
        setDraft((current) => ({ ...current, unmentioned: value as ChannelRouteUnmentioned })),
      changeMaxMessages: (text) => setDraft((current) => ({ ...current, maxMessages: text })),
      changeBatchingOn: (on) =>
        setDraft((current) => setRouteBatchingOn({ ...current, inherited }, on)),
      changeBatchingField: (name, text) =>
        setDraft((current) => setRouteBatchingField({ ...current, inherited }, name, text)),
      changeWhenBusy: (value) =>
        setDraft((current) => ({ ...current, whenBusy: value as ChannelRouteWhenBusy })),
    }),
    [inherited],
  );
  return { draft, parsed, commands };
}

export function RouteConversationSection({
  draft,
  parsed,
  commands,
  showUnmentioned,
  pending,
}: {
  draft: RouteConversationDraft;
  parsed: ParsedRouteConversation;
  commands: RouteConversationCommands;
  /** Only a group that needs a mention has messages without one. */
  showUnmentioned: boolean;
  pending: boolean;
}) {
  const shown = routeConversationDisplay(draft);
  return (
    <RouteFormSection title="Conversation context" info={CONVERSATION_CONTEXT_INFO}>
      <View>
        <Text style={settingsStyles.rowHint}>Each message reaches the Agent with its sender:</Text>
        <Text style={styles.example}>Minh Dương (slack:U018WR2K090, @minh.duong): …</Text>
      </View>
      {showUnmentioned ? (
        <View>
          <ChoiceRow
            label="Earlier messages without a mention"
            values={UNMENTIONED_VALUES}
            selected={shown.unmentioned}
            labels={UNMENTIONED_LABELS}
            onChange={commands.changeUnmentioned}
            disabled={pending}
          />
          <Text style={settingsStyles.rowHint}>Sent as quoted context, not as instructions.</Text>
        </View>
      ) : null}
      <RouteNumberRow
        label="Earlier messages to include"
        unit="messages"
        value={shown.maxMessages}
        error={parsed.errors.maxMessages}
        onChange={commands.changeMaxMessages}
        disabled={pending}
      />
      <FoldedRouteFormSubgroup
        title="Advanced"
        summary={advancedSummary(shown.batchingOn, shown.whenBusy)}
        inUse={shown.advancedInUse}
      >
        <RouteBatchingFields shown={shown} parsed={parsed} commands={commands} pending={pending} />
        <ChoiceRow
          label="When the Agent is busy"
          note="Steer sends the message into the work already running. Queue holds it until that work finishes."
          values={WHEN_BUSY_VALUES}
          selected={shown.whenBusy}
          labels={WHEN_BUSY_LABELS}
          onChange={commands.changeWhenBusy}
          disabled={pending}
        />
      </FoldedRouteFormSubgroup>
    </RouteFormSection>
  );
}

function RouteBatchingFields({
  shown,
  parsed,
  commands,
  pending,
}: {
  shown: ReturnType<typeof routeConversationDisplay>;
  parsed: ParsedRouteConversation;
  commands: RouteConversationCommands;
  pending: boolean;
}) {
  return (
    <>
      <RouteBehaviorSwitch
        label="Batch messages"
        value={shown.batchingOn}
        onChange={commands.changeBatchingOn}
        disabled={pending}
      />
      {shown.batchingOn
        ? BATCHING_ROWS.map(({ name, label, unit }) => (
            <BatchingRow
              key={name}
              name={name}
              label={label}
              unit={unit}
              value={shown.batchingFields[name]}
              error={parsed.errors.batching[name]}
              onChange={commands.changeBatchingField}
              disabled={pending}
            />
          ))
        : null}
    </>
  );
}

function BatchingRow({
  name,
  onChange,
  ...row
}: Omit<RouteNumberRowProps, "onChange"> & {
  name: BatchingFieldName;
  onChange(name: BatchingFieldName, text: string): void;
}) {
  const change = useCallback((text: string) => onChange(name, text), [name, onChange]);
  return <RouteNumberRow {...row} onChange={change} />;
}

function advancedSummary(batchingOn: boolean, whenBusy: ChannelRouteWhenBusy): string {
  const batching = batchingOn ? "Batch messages" : "No batching";
  return `${batching} · When busy: ${WHEN_BUSY_LABELS[whenBusy].toLowerCase()}`;
}

const styles = StyleSheet.create((theme) => ({
  example: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
}));
