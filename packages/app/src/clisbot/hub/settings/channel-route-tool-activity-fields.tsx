import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  TOOL_DETAIL_VALUES,
  WHEN_THROTTLED_VALUES,
  type ChannelRouteToolDetail,
  type ChannelRouteWhenThrottled,
  type EffectiveChannelRouteToolActivity,
} from "../channel-route-tool-activity";
import { ChoiceRow, RouteBehaviorSwitch, RouteNumberRow } from "./channel-route-behavior-rows";
import {
  openRouteToolActivityDraft,
  parseRouteToolActivityDraft,
  routeToolActivityDisplay,
  setRouteToolActivityField,
  setRouteToolActivityOn,
  type ParsedRouteToolActivity,
  type RouteToolActivityDraft,
} from "./channel-route-tool-activity-form";

// The Replies section's Show tool activity switch and the options it carries
// (docs/features/channels/conversation-flow.md, "Configuration").

function toolDetailLabels(t: TFunction): Record<ChannelRouteToolDetail, string> {
  return {
    name: t("hub.routes.toolActivity.details.name"),
    short: t("hub.routes.toolActivity.details.short"),
    full: t("hub.routes.toolActivity.details.full"),
  };
}
function toolDetailDescriptions(t: TFunction): Record<ChannelRouteToolDetail, string> {
  return {
    name: t("hub.routes.toolActivity.detailDescriptions.name"),
    short: t("hub.routes.toolActivity.detailDescriptions.short"),
    full: t("hub.routes.toolActivity.detailDescriptions.full"),
  };
}
function whenThrottledLabels(t: TFunction): Record<ChannelRouteWhenThrottled, string> {
  return {
    update: t("hub.routes.toolActivity.whenThrottledOptions.update"),
    skip: t("hub.routes.toolActivity.whenThrottledOptions.skip"),
  };
}

export interface RouteToolActivityCommands {
  changeOn(on: boolean): void;
  changeDetail(value: string): void;
  changeThrottleSeconds(text: string): void;
  changeWhenThrottled(value: string): void;
}

export interface RouteToolActivityForm {
  draft: RouteToolActivityDraft;
  parsed: ParsedRouteToolActivity;
  commands: RouteToolActivityCommands;
}

/**
 * The switch's draft for one open form; `parsed.value` is what a save writes.
 * What the Route inherits follows the picked Connection, so it is an input on
 * every render, not part of the opened draft.
 */
export function useRouteToolActivityDraft(
  route: Record<string, unknown> | undefined,
  inherited: EffectiveChannelRouteToolActivity,
): RouteToolActivityForm {
  const [opened, setDraft] = useState(() => openRouteToolActivityDraft(route, inherited));
  const draft = useMemo(() => ({ ...opened, inherited }), [opened, inherited]);
  const parsed = useMemo(() => parseRouteToolActivityDraft(draft), [draft]);
  const commands = useMemo<RouteToolActivityCommands>(
    () => ({
      changeOn: (on) =>
        setDraft((current) => setRouteToolActivityOn({ ...current, inherited }, on)),
      changeDetail: (value) =>
        setDraft((current) =>
          setRouteToolActivityField(
            { ...current, inherited },
            "detail",
            value as ChannelRouteToolDetail,
          ),
        ),
      changeThrottleSeconds: (text) =>
        setDraft((current) =>
          setRouteToolActivityField({ ...current, inherited }, "throttleSeconds", text),
        ),
      changeWhenThrottled: (value) =>
        setDraft((current) =>
          setRouteToolActivityField(
            { ...current, inherited },
            "whenThrottled",
            value as ChannelRouteWhenThrottled,
          ),
        ),
    }),
    [inherited],
  );
  return { draft, parsed, commands };
}

/** The switch, and the options it reveals while it is on. */
export function RouteToolActivityFields({
  draft,
  parsed,
  commands,
  pending,
}: RouteToolActivityForm & { pending: boolean }) {
  const { t } = useTranslation();
  const shown = routeToolActivityDisplay(draft);
  return (
    <>
      <RouteBehaviorSwitch
        label={t("hub.routes.toolActivity.show")}
        value={shown.on}
        onChange={commands.changeOn}
        disabled={pending}
      />
      {shown.on ? (
        <ToolActivityOptions shown={shown} parsed={parsed} commands={commands} pending={pending} />
      ) : null}
    </>
  );
}

function ToolActivityOptions({
  shown,
  parsed,
  commands,
  pending,
}: {
  shown: ReturnType<typeof routeToolActivityDisplay>;
  parsed: ParsedRouteToolActivity;
  commands: RouteToolActivityCommands;
  pending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ChoiceRow
        label={t("hub.routes.toolActivity.detail")}
        values={TOOL_DETAIL_VALUES}
        selected={shown.fields.detail}
        labels={toolDetailLabels(t)}
        descriptions={toolDetailDescriptions(t)}
        onChange={commands.changeDetail}
        disabled={pending}
      />
      <RouteNumberRow
        label={t("hub.routes.toolActivity.throttle")}
        unit={t("hub.routes.common.secondsUnit")}
        value={shown.fields.throttleSeconds}
        {...(parsed.valid ? {} : { error: parsed.error })}
        onChange={commands.changeThrottleSeconds}
        disabled={pending}
      />
      {shown.throttled ? (
        <ChoiceRow
          label={t("hub.routes.toolActivity.whenThrottled")}
          values={WHEN_THROTTLED_VALUES}
          selected={shown.fields.whenThrottled}
          labels={whenThrottledLabels(t)}
          onChange={commands.changeWhenThrottled}
          disabled={pending}
        />
      ) : null}
    </>
  );
}
