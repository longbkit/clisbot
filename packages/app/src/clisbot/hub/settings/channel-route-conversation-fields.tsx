import type { TFunction } from "i18next";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
function unmentionedLabels(t: TFunction): Record<ChannelRouteUnmentioned, string> {
  return {
    everyone: t("hub.routes.conversation.unmentioned.everyone"),
    "allowed-senders": t("hub.routes.conversation.unmentioned.allowedSenders"),
    none: t("hub.routes.conversation.unmentioned.none"),
  };
}
// The app's own words for the same choice (Settings → General, "Default
// send"): Enter steers the running turn, Command/Ctrl+Enter queues it.
function whenBusyLabels(t: TFunction): Record<ChannelRouteWhenBusy, string> {
  return {
    steer: t("hub.routes.conversation.whenBusy.steer"),
    queue: t("hub.routes.conversation.whenBusy.queue"),
  };
}
function batchingRows(t: TFunction): { name: BatchingFieldName; label: string; unit?: string }[] {
  const seconds = t("hub.routes.common.secondsUnit");
  return [
    { name: "pauseSeconds", label: t("hub.routes.conversation.pauseSeconds"), unit: seconds },
    { name: "maxWaitSeconds", label: t("hub.routes.conversation.maxWaitSeconds"), unit: seconds },
    { name: "maxMessages", label: t("hub.routes.conversation.maxMessages") },
  ];
}

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
  const { t } = useTranslation();
  const shown = routeConversationDisplay(draft);
  return (
    <FoldedRouteFormSection
      title={t("hub.routes.conversation.title")}
      info={t("hub.routes.conversation.info")}
      summary={messageHandlingSummary(t, draft, shown)}
      inUse={shown.inUse}
    >
      {showUnmentioned ? (
        <ChoiceRow
          label={t("hub.routes.conversation.catchUpFrom")}
          values={UNMENTIONED_VALUES}
          selected={shown.unmentioned}
          labels={unmentionedLabels(t)}
          onChange={commands.changeUnmentioned}
          disabled={pending}
        />
      ) : null}
      <RouteNumberRow
        label={t("hub.routes.conversation.catchUpLimit")}
        unit={t("hub.routes.common.messagesUnit")}
        value={shown.maxMessages}
        error={parsed.errors.maxMessages}
        onChange={commands.changeMaxMessages}
        disabled={pending}
      />
      <RouteBatchingFields shown={shown} parsed={parsed} commands={commands} pending={pending} />
      <ChoiceRow
        label={t("hub.routes.conversation.newWhileBusy")}
        layout="row"
        values={WHEN_BUSY_VALUES}
        selected={shown.whenBusy}
        labels={whenBusyLabels(t)}
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
  const { t } = useTranslation();
  return (
    <>
      <RouteBehaviorSwitch
        label={t("hub.routes.conversation.batchBursts")}
        value={shown.batchingOn}
        onChange={commands.changeBatchingOn}
        disabled={pending}
      />
      {shown.batchingOn
        ? batchingRows(t).map(({ name, label, unit }) => (
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

function catchUpSummary(t: TFunction, unmentioned: ChannelRouteUnmentioned): string {
  if (unmentioned === "everyone") return t("hub.routes.conversation.summaryCatchUpFrom.everyone");
  if (unmentioned === "allowed-senders")
    return t("hub.routes.conversation.summaryCatchUpFrom.allowedSenders");
  return t("hub.routes.conversation.summaryCatchUpFrom.none");
}

function batchingSummary(t: TFunction, on: boolean): string {
  return on
    ? t("hub.routes.conversation.summaryBatching")
    : t("hub.routes.conversation.summaryNoBatching");
}

function whenBusySummary(t: TFunction, whenBusy: ChannelRouteWhenBusy): string {
  return whenBusy === "steer"
    ? t("hub.routes.conversation.summaryWhenBusy.steer")
    : t("hub.routes.conversation.summaryWhenBusy.queue");
}

/**
 * The folded line names only what this Route changed, so an untouched Route
 * reads "Default" (as Limits does) instead of a line of values to decode.
 */
function messageHandlingSummary(
  t: TFunction,
  draft: RouteConversationDraft,
  shown: ReturnType<typeof routeConversationDisplay>,
): string {
  const changed = [
    draft.unmentioned === undefined ? null : catchUpSummary(t, shown.unmentioned),
    draft.maxMessages === undefined
      ? null
      : t("hub.routes.conversation.summaryCatchUpLimit", { limit: shown.maxMessages }),
    draft.batching === undefined ? null : batchingSummary(t, shown.batchingOn),
    draft.whenBusy === undefined ? null : whenBusySummary(t, shown.whenBusy),
  ].filter((item) => item !== null);
  return changed.length === 0 ? t("hub.routes.common.default") : changed.join(" · ");
}
