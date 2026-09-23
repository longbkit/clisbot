import { useMemo, useState } from "react";
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

const TOOL_DETAIL_LABELS: Record<ChannelRouteToolDetail, string> = {
  name: "Tool name only",
  short: "Tool and short command",
  full: "Tool and full command",
};
const TOOL_DETAIL_NOTE = "How much of each tool line lands in the conversation.";
const WHEN_THROTTLED_LABELS: Record<ChannelRouteWhenThrottled, string> = {
  update: "Update the last line",
  skip: "Skip it",
};

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
  const shown = routeToolActivityDisplay(draft);
  return (
    <>
      <RouteBehaviorSwitch
        label="Show tool activity"
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
  return (
    <>
      <ChoiceRow
        label="Tool detail"
        note={TOOL_DETAIL_NOTE}
        values={TOOL_DETAIL_VALUES}
        selected={shown.fields.detail}
        labels={TOOL_DETAIL_LABELS}
        onChange={commands.changeDetail}
        disabled={pending}
      />
      <RouteNumberRow
        label="At most one line every"
        unit="seconds"
        value={shown.fields.throttleSeconds}
        {...(parsed.valid ? {} : { error: parsed.error })}
        onChange={commands.changeThrottleSeconds}
        disabled={pending}
      />
      {shown.throttled ? (
        <ChoiceRow
          label="When throttled"
          values={WHEN_THROTTLED_VALUES}
          selected={shown.fields.whenThrottled}
          labels={WHEN_THROTTLED_LABELS}
          onChange={commands.changeWhenThrottled}
          disabled={pending}
        />
      ) : null}
    </>
  );
}
