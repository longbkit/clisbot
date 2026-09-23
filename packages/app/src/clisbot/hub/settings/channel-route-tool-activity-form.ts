import {
  authorsToolActivityOptions,
  readChannelRouteToolActivity,
  type ChannelRouteToolActivity,
  type ChannelRouteToolDetail,
  type ChannelRouteWhenThrottled,
  type EffectiveChannelRouteToolActivity,
} from "../channel-route-tool-activity";

// The Route form's Show tool activity switch and its options as a plain model:
// the draft opens from the stored Route and what it inherits, commands return
// the next draft, and `parseRouteToolActivityDraft` gives the leaf a save
// writes. A leaf the Route does not author shows the inherited value and is
// left out of a save, like the Reply method above it: turning the switch on
// writes `true`, and only an option the user changes is written beside it.

export interface RouteToolActivityFieldsDraft {
  detail: ChannelRouteToolDetail;
  /** Typed text for `throttleSeconds`. */
  throttleSeconds: string;
  whenThrottled: ChannelRouteWhenThrottled;
}

export type ToolActivityFieldName = keyof RouteToolActivityFieldsDraft;

export interface RouteToolActivityDraft {
  inherited: EffectiveChannelRouteToolActivity;
  /** The Route's own switch; absent inherits. */
  toolCalls?: "off" | "on";
  /**
   * The options the Route authors or the user typed; an absent one inherits.
   * Absent altogether means the leaf is a bare switch, written as a boolean.
   */
  fields?: Partial<RouteToolActivityFieldsDraft>;
}

export type ParsedRouteToolActivity =
  | { valid: true; value: ChannelRouteToolActivity | undefined }
  | { valid: false; error: string };

const THROTTLE_ERROR = "Use a whole number of seconds, 0 or more.";

/** Opens the draft from the stored Route and what it inherits. */
export function openRouteToolActivityDraft(
  route: Record<string, unknown> | undefined,
  inherited: EffectiveChannelRouteToolActivity,
): RouteToolActivityDraft {
  const { enabled, detail, throttleSeconds, whenThrottled } = readChannelRouteToolActivity(route);
  const fields = {
    ...(detail === undefined ? {} : { detail }),
    ...(throttleSeconds === undefined ? {} : { throttleSeconds: String(throttleSeconds) }),
    ...(whenThrottled === undefined ? {} : { whenThrottled }),
  };
  return {
    inherited,
    ...(enabled === undefined ? {} : { toolCalls: enabled ? ("on" as const) : ("off" as const) }),
    ...(authorsToolActivityOptions(route) ? { fields } : {}),
  };
}

/** What the rows show: the Route's own value, or the one it inherits. */
export function routeToolActivityDisplay(draft: RouteToolActivityDraft) {
  const fields = shownFields(draft);
  return {
    on: draft.toolCalls === undefined ? draft.inherited.enabled : draft.toolCalls === "on",
    fields,
    /** Nothing is ever throttled at 0, so what to do when throttled does not apply. */
    throttled: parseThrottleSeconds(fields.throttleSeconds) !== 0,
  };
}

export function setRouteToolActivityOn(
  draft: RouteToolActivityDraft,
  on: boolean,
): RouteToolActivityDraft {
  // Off keeps no options: the leaf is written as a plain `false`.
  return { ...draft, toolCalls: on ? "on" : "off" };
}

/** Changing an option turns tool activity on for the Route, even when it was inherited on. */
export function setRouteToolActivityField<Name extends ToolActivityFieldName>(
  draft: RouteToolActivityDraft,
  name: Name,
  value: RouteToolActivityFieldsDraft[Name],
): RouteToolActivityDraft {
  return { ...draft, toolCalls: "on", fields: { ...draft.fields, [name]: value } };
}

export function parseRouteToolActivityDraft(
  draft: RouteToolActivityDraft,
): ParsedRouteToolActivity {
  if (draft.toolCalls === undefined) return { valid: true, value: undefined };
  if (draft.toolCalls === "off") return { valid: true, value: false };
  const { fields } = draft;
  // On with nothing of its own: the options stay the layer below's to decide.
  if (fields === undefined) return { valid: true, value: true };
  const typed = fields.throttleSeconds;
  const seconds = typed === undefined ? undefined : parseThrottleSeconds(typed);
  if (typed !== undefined && seconds === undefined) return { valid: false, error: THROTTLE_ERROR };
  return {
    valid: true,
    value: {
      ...(fields.detail === undefined ? {} : { detail: fields.detail }),
      ...(seconds === undefined ? {} : { throttleSeconds: seconds }),
      // Written even at a throttle of 0, where the row is hidden: the choice is
      // the Route's, and it applies again the moment a throttle is set.
      ...(fields.whenThrottled === undefined ? {} : { whenThrottled: fields.whenThrottled }),
    },
  };
}

function shownFields(draft: RouteToolActivityDraft): RouteToolActivityFieldsDraft {
  const { fields, inherited } = draft;
  return {
    detail: fields?.detail ?? inherited.detail,
    throttleSeconds: fields?.throttleSeconds ?? String(inherited.throttleSeconds),
    whenThrottled: fields?.whenThrottled ?? inherited.whenThrottled,
  };
}

/** Whole seconds typed as text, 0 included, or undefined. */
function parseThrottleSeconds(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : undefined;
}
