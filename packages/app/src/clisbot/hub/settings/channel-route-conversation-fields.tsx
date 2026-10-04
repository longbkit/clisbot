import { useCallback, useMemo, useState } from "react";
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
import { FoldedRouteFormSection } from "./channel-route-form-sections";

// The Route form's Incoming messages section
// (docs/features/channels/conversation-flow.md, "Configuration"). It starts
// folded, like Limits: the defaults suit most Routes.

// Every row explains itself; what each one does in detail is in the ⓘ.
const MESSAGE_HANDLING_INFO =
  "Catch up: when someone mentions the Agent, it first reads what was said since its last reply, as background, not as instructions. Batch message bursts: several messages sent in a row get one answer. While the Agent is busy: Steer adds a new message to the work in progress, Queue holds it until that work is done. Every message names its sender, e.g. An Nguyễn (slack:U0000000001): …";
const UNMENTIONED_LABELS: Record<ChannelRouteUnmentioned, string> = {
  everyone: "Everyone",
  "allowed-senders": "Allowed senders only",
  none: "No one",
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
    <FoldedRouteFormSection
      title="Incoming messages"
      info={MESSAGE_HANDLING_INFO}
      summary={messageHandlingSummary(draft, shown)}
      inUse={shown.inUse}
    >
      {showUnmentioned ? (
        <ChoiceRow
          label="Catch up on missed messages from"
          values={UNMENTIONED_VALUES}
          selected={shown.unmentioned}
          labels={UNMENTIONED_LABELS}
          onChange={commands.changeUnmentioned}
          disabled={pending}
        />
      ) : null}
      <RouteNumberRow
        label="Catch-up limit"
        unit="messages"
        value={shown.maxMessages}
        error={parsed.errors.maxMessages}
        onChange={commands.changeMaxMessages}
        disabled={pending}
      />
      <RouteBatchingFields shown={shown} parsed={parsed} commands={commands} pending={pending} />
      <ChoiceRow
        label="New message while the Agent is busy"
        layout="row"
        values={WHEN_BUSY_VALUES}
        selected={shown.whenBusy}
        labels={WHEN_BUSY_LABELS}
        onChange={commands.changeWhenBusy}
        disabled={pending}
      />
    </FoldedRouteFormSection>
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
        label="Batch message bursts"
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

const BATCHING_SUMMARIES: Record<string, string> = {
  true: "Batches message bursts",
  false: "No batching",
};

/**
 * The folded line names only what this Route changed, so an untouched Route
 * reads "Default" (as Limits does) instead of a line of values to decode.
 */
function messageHandlingSummary(
  draft: RouteConversationDraft,
  shown: ReturnType<typeof routeConversationDisplay>,
): string {
  const changed = [
    draft.unmentioned === undefined
      ? null
      : `Catches up from: ${UNMENTIONED_LABELS[shown.unmentioned].toLowerCase()}`,
    draft.maxMessages === undefined ? null : `Catch-up limit: ${shown.maxMessages}`,
    draft.batching === undefined ? null : BATCHING_SUMMARIES[String(shown.batchingOn)],
    draft.whenBusy === undefined
      ? null
      : `If busy: ${WHEN_BUSY_LABELS[shown.whenBusy].toLowerCase()}`,
  ].filter((item) => item !== null);
  return changed.length === 0 ? "Default" : changed.join(" · ");
}
