// A Route's conversation leaves (docs/features/channels/conversation-flow.md,
// "Configuration"): what earlier messages reach the Agent with a trigger, how
// a burst is batched, and what a message does while a turn runs. Each leaf is
// an inherited `defaults:` leaf (organization < account < Route); on a Route
// the defaults keys sit at the top level, beside `interaction` and `sync`.

type ConfigurationRecord = Record<string, unknown>;

export type ChannelRouteWhenBusy = "steer" | "queue";
export type ChannelRouteUnmentioned = "everyone" | "allowed-senders" | "none";

export interface ChannelRouteBatching {
  /** Send once no new message arrived for this long. Above 0: off is `"off"`. */
  pauseSeconds: number;
  /** Send once the first message waited this long. Above `pauseSeconds`. */
  maxWaitSeconds: number;
  maxMessages: number;
}

/** The leaves one layer authors. An absent leaf inherits from the layer below. */
export interface ChannelRouteConversation {
  whenBusy?: ChannelRouteWhenBusy;
  unmentioned?: ChannelRouteUnmentioned;
  maxMessages?: number;
  batching?: "off" | ChannelRouteBatching;
}

export type EffectiveChannelRouteConversation = Required<ChannelRouteConversation>;

export const WHEN_BUSY_VALUES: ChannelRouteWhenBusy[] = ["steer", "queue"];
export const UNMENTIONED_VALUES: ChannelRouteUnmentioned[] = [
  "everyone",
  "allowed-senders",
  "none",
];

/** The organization floor the Hub applies when no layer authors a leaf. */
export const ORG_CONVERSATION_DEFAULTS: EffectiveChannelRouteConversation = {
  whenBusy: "steer",
  unmentioned: "everyone",
  maxMessages: 20,
  batching: "off",
};

/** Mirrors the Hub's `CONTEXT_MAX_MESSAGES_CEILING`: every kept message is prompt text. */
export const CONTEXT_MAX_MESSAGES_CEILING = 200;

/** Where the batching rows start when a Route turns batching on. */
export const DEFAULT_CHANNEL_BATCHING: ChannelRouteBatching = {
  pauseSeconds: 3,
  maxWaitSeconds: 10,
  maxMessages: 20,
};

/**
 * The conversation leaves one layer authors: a Route, or an account's or the
 * organization's `defaults:`. A leaf of the wrong shape is left out, so the
 * form shows what the layer below gives and a save keeps the stored value.
 */
export function readChannelRouteConversation(
  layer: ConfigurationRecord | undefined,
): ChannelRouteConversation {
  const interaction = recordOf(layer?.["interaction"]);
  const context = recordOf(layer?.["context"]);
  const whenBusy = WHEN_BUSY_VALUES.find((value) => value === interaction["whenBusy"]);
  const unmentioned = UNMENTIONED_VALUES.find((value) => value === context["unmentioned"]);
  const maxMessages = context["maxMessages"];
  const batching = readBatching(layer?.["batching"]);
  return {
    ...(whenBusy === undefined ? {} : { whenBusy }),
    ...(unmentioned === undefined ? {} : { unmentioned }),
    ...(isContextMaxMessages(maxMessages) ? { maxMessages } : {}),
    ...(batching === undefined ? {} : { batching }),
  };
}

/** What a Route inherits: the organization floor under each `defaults:` layer, lowest first. */
export function inheritedChannelRouteConversation(
  layers: readonly (ConfigurationRecord | undefined)[],
): EffectiveChannelRouteConversation {
  const effective = { ...ORG_CONVERSATION_DEFAULTS };
  for (const layer of layers) Object.assign(effective, readChannelRouteConversation(layer));
  return effective;
}

/**
 * The Route keys a save writes for the leaves the Route authors, merged into
 * the Route's other settings. An inherited leaf writes nothing.
 */
export function withChannelRouteConversation(
  settings: ConfigurationRecord,
  conversation: ChannelRouteConversation | undefined,
): ConfigurationRecord {
  if (conversation === undefined) return settings;
  const { whenBusy, unmentioned, maxMessages, batching } = conversation;
  const context = {
    ...(unmentioned === undefined ? {} : { unmentioned }),
    ...(maxMessages === undefined ? {} : { maxMessages }),
  };
  return {
    ...settings,
    ...(whenBusy === undefined
      ? {}
      : { interaction: { ...recordOf(settings["interaction"]), whenBusy } }),
    ...(Object.keys(context).length === 0 ? {} : { context }),
    ...(batching === undefined ? {} : { batching: batchingRecord(batching) }),
  };
}

function batchingRecord(batching: "off" | ChannelRouteBatching): "off" | ConfigurationRecord {
  if (batching === "off") return "off";
  const { pauseSeconds, maxWaitSeconds, maxMessages } = batching;
  return { pauseSeconds, maxWaitSeconds, maxMessages };
}

function readBatching(value: unknown): "off" | ChannelRouteBatching | undefined {
  if (value === "off") return "off";
  const batching = recordOf(value);
  const { pauseSeconds, maxWaitSeconds, maxMessages } = batching;
  if (!isPositiveNumber(pauseSeconds) || !isPositiveNumber(maxWaitSeconds)) return undefined;
  if (!isPositiveInteger(maxMessages) || maxWaitSeconds <= pauseSeconds) return undefined;
  return { pauseSeconds, maxWaitSeconds, maxMessages };
}

/** `context.maxMessages`: 0 keeps no earlier messages. */
export function isContextMaxMessages(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= CONTEXT_MAX_MESSAGES_CEILING
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function recordOf(value: unknown): ConfigurationRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ConfigurationRecord)
    : {};
}
