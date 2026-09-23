// A Route's tool-activity leaf: `sync.toolCalls`, the line a conversation gets
// for a tool the Agent runs. Like the conversation leaves it is inherited
// (organization < account < Route), and each leaf under it is inherited on its
// own: `toolCalls: true` turns the surface on and says nothing else, an object
// turns it on and sets the leaves it names. Mirrors `SyncToolCallsSchema` in
// packages/hub/src/channels/config/schema.ts.

type ConfigurationRecord = Record<string, unknown>;

/** How much of a tool call one line carries. */
export type ChannelRouteToolDetail = "name" | "short" | "full";
/** What a tool call does while the last line is still inside the throttle. */
export type ChannelRouteWhenThrottled = "update" | "skip";

export interface ChannelRouteToolActivityOptions {
  detail: ChannelRouteToolDetail;
  /** Seconds between the lines of tools that start. 0 posts every tool call. */
  throttleSeconds: number;
  whenThrottled: ChannelRouteWhenThrottled;
}

/**
 * What one layer writes: `false` for no tool line at all, `true` to turn the
 * lines on and leave every option to the layer below, or the options it sets.
 */
export type ChannelRouteToolActivity = boolean | Partial<ChannelRouteToolActivityOptions>;

/** What one layer authors. An absent leaf inherits from the layer below. */
export interface ChannelRouteToolActivityLeaves extends Partial<ChannelRouteToolActivityOptions> {
  enabled?: boolean;
}

export type EffectiveChannelRouteToolActivity = Required<ChannelRouteToolActivityLeaves>;

export const TOOL_DETAIL_VALUES: ChannelRouteToolDetail[] = ["name", "short", "full"];
export const WHEN_THROTTLED_VALUES: ChannelRouteWhenThrottled[] = ["update", "skip"];

/** What the options resolve to the moment a layer turns tool activity on. */
export const DEFAULT_TOOL_ACTIVITY: ChannelRouteToolActivityOptions = {
  detail: "short",
  throttleSeconds: 30,
  whenThrottled: "update",
};

/** The organization floor the Hub applies when no layer authors a leaf. Mirrors
 * `ORG_DEFAULTS.sync.toolCalls` (packages/hub/src/channels/config/schema.ts). */
export const ORG_TOOL_ACTIVITY: EffectiveChannelRouteToolActivity = {
  enabled: false,
  ...DEFAULT_TOOL_ACTIVITY,
};

/**
 * The leaves one layer authors: a Route, or an account's or the organization's
 * `defaults:`. A leaf of the wrong shape is left out, so the form shows what
 * the layer below gives and a save keeps the stored value.
 */
export function readChannelRouteToolActivity(
  layer: ConfigurationRecord | undefined,
): ChannelRouteToolActivityLeaves {
  const toolCalls = toolCallsValue(layer);
  if (typeof toolCalls === "boolean") return { enabled: toolCalls };
  if (!isRecord(toolCalls)) return {};
  const detail = TOOL_DETAIL_VALUES.find((value) => value === toolCalls["detail"]);
  const throttleSeconds = toolCalls["throttleSeconds"];
  const whenThrottled = WHEN_THROTTLED_VALUES.find((value) => value === toolCalls["whenThrottled"]);
  return {
    enabled: true,
    ...(detail === undefined ? {} : { detail }),
    ...(isThrottleSeconds(throttleSeconds) ? { throttleSeconds } : {}),
    ...(whenThrottled === undefined ? {} : { whenThrottled }),
  };
}

/**
 * Whether a layer spells the leaf as options rather than a bare switch. A save
 * keeps the spelling, so a key the form does not show survives under it.
 */
export function authorsToolActivityOptions(layer: ConfigurationRecord | undefined): boolean {
  return isRecord(toolCallsValue(layer));
}

/** What a Route inherits: the organization floor under each `defaults:` layer, lowest first. */
export function inheritedChannelRouteToolActivity(
  layers: readonly (ConfigurationRecord | undefined)[],
): EffectiveChannelRouteToolActivity {
  const effective = { ...ORG_TOOL_ACTIVITY };
  for (const layer of layers) Object.assign(effective, readChannelRouteToolActivity(layer));
  return effective;
}

/**
 * The `sync.toolCalls` a save writes, merged into the Route's other settings.
 * An inherited leaf writes nothing, so the layer below still applies, and an
 * option the Route does not set is left out rather than pinned.
 */
export function withChannelRouteToolActivity(
  settings: ConfigurationRecord,
  toolActivity: ChannelRouteToolActivity | undefined,
): ConfigurationRecord {
  if (toolActivity === undefined) return settings;
  return {
    ...settings,
    sync: { ...recordOf(settings["sync"]), toolCalls: toolActivityRecord(toolActivity) },
  };
}

function toolActivityRecord(toolActivity: ChannelRouteToolActivity): boolean | ConfigurationRecord {
  if (typeof toolActivity === "boolean") return toolActivity;
  const { detail, throttleSeconds, whenThrottled } = toolActivity;
  return {
    ...(detail === undefined ? {} : { detail }),
    ...(throttleSeconds === undefined ? {} : { throttleSeconds }),
    ...(whenThrottled === undefined ? {} : { whenThrottled }),
  };
}

function toolCallsValue(layer: ConfigurationRecord | undefined): unknown {
  return recordOf(layer?.["sync"])["toolCalls"];
}

/** `throttleSeconds`: whole seconds, 0 posting every tool call. */
export function isThrottleSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is ConfigurationRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOf(value: unknown): ConfigurationRecord {
  return isRecord(value) ? value : {};
}
