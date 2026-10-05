// Channel limits as a form model, no React: each leaf is left at its default,
// set to a number, or turned off. One model serves the Bot, each Conversation,
// a Route and a Rule (docs/audits/2026-10-05-routes-and-rules.md#limits).

import {
  CHANNEL_LIMIT_NAMES,
  DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS,
  type ChannelLimitName,
  type ChannelLimits,
} from "../channel-configuration";

export type LimitMode = "default" | "custom" | "off";
export interface LimitDraft {
  mode: LimitMode;
  value: string;
}
export type ChannelLimitsDraft = Record<ChannelLimitName, LimitDraft>;
export type ChannelLimitDefaults = Partial<Record<ChannelLimitName, number>>;

export const LIMIT_LABELS: Record<ChannelLimitName, string> = {
  maxInputCharacters: "Message length",
  messagesPerMinutePerSender: "Messages handled per minute, per person",
  messagesPerMinute: "Messages handled per minute",
  messagesSentPerMinute: "Bot messages per minute",
  maxConcurrentRuns: "Concurrent runs",
  maxRuntimeSeconds: "Run time",
};

/** Said after the number, so the label stays short. */
export const LIMIT_UNITS: Partial<Record<ChannelLimitName, string>> = {
  maxInputCharacters: "characters",
  maxRuntimeSeconds: "seconds",
};

/** The one line that says how every limit behaves, over its fields. */
export const LIMITS_NOTE =
  "Empty uses the default. Handled messages start or continue work. Over a limit, messages and runs wait their turn; a longer message is refused, a longer run stopped.";

/** A Rule's limits: everything about who comes in. Posts belong to no sender. */
export const RULE_LIMIT_NAMES: readonly ChannelLimitName[] = CHANNEL_LIMIT_NAMES.filter(
  (name) => name !== "messagesSentPerMinute",
);

/** A Route's own: totals for every Rule of it together. */
export const ROUTE_TOTAL_LIMIT_NAMES: readonly ChannelLimitName[] = [
  "messagesPerMinute",
  "maxConcurrentRuns",
];

/** The Bot and Conversation scopes have no defaults: unset means no limit. */
export const NO_DEFAULTS: ChannelLimitDefaults = {};

export function channelLimitsDraft(authored: unknown): ChannelLimitsDraft {
  const record =
    typeof authored === "object" && authored !== null ? (authored as Record<string, unknown>) : {};
  const entry = (name: ChannelLimitName): LimitDraft => {
    const value = record[name];
    if (value === "off") return { mode: "off", value: "" };
    if (typeof value === "number") return { mode: "custom", value: String(value) };
    return { mode: "default", value: "" };
  };
  return Object.fromEntries(
    CHANNEL_LIMIT_NAMES.map((name) => [name, entry(name)]),
  ) as ChannelLimitsDraft;
}

/** The leaves the form writes; `names` limits it to the ones its scope carries. */
export function parseChannelLimitsDraft(
  draft: ChannelLimitsDraft,
  names: readonly ChannelLimitName[] = CHANNEL_LIMIT_NAMES,
): { valid: true; value: ChannelLimits } | { valid: false; error: string } {
  const value: ChannelLimits = {};
  for (const name of names) {
    const { mode, value: text } = draft[name];
    if (mode === "off") value[name] = "off";
    if (mode !== "custom") continue;
    const parsed = Number(text.trim());
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return { valid: false, error: `${LIMIT_LABELS[name]}: use a positive whole number.` };
    }
    value[name] = parsed;
  }
  return { valid: true, value };
}

/** Whether any leaf of these is set or turned off. */
export function limitsAuthored(
  draft: ChannelLimitsDraft,
  names: readonly ChannelLimitName[] = CHANNEL_LIMIT_NAMES,
): boolean {
  return names.some((name) => draft[name].mode !== "default");
}

/** One line for a card: what is set, or that everything is at its default. */
export function channelLimitsSummary(
  limits: unknown,
  names: readonly ChannelLimitName[] = CHANNEL_LIMIT_NAMES,
  /** What a scope with nothing set says: a scope with no defaults has "No limits". */
  empty = "Default limits",
): string {
  const draft = channelLimitsDraft(limits);
  const set = names.flatMap((name) => {
    const { mode, value } = draft[name];
    if (mode === "default") return [];
    return [`${LIMIT_LABELS[name]}: ${mode === "off" ? "off" : value}`];
  });
  return set.length === 0 ? empty : set.join(" · ");
}

/**
 * What a Rule meets for a limit it does not set, as the Hub reads it
 * (`ruleLimits`): the Route's own leaf, else, for a Rule that lets anyone in,
 * the open-audience default. A Route leaf turned off leaves no default.
 */
export function ruleLimitDefaults(
  route: ChannelLimits,
  letsAnyoneIn: boolean,
): ChannelLimitDefaults {
  const defaults: ChannelLimitDefaults = {};
  for (const name of RULE_LIMIT_NAMES) {
    const value = ruleLimitDefault(
      route[name],
      letsAnyoneIn ? DEFAULT_OPEN_AUDIENCE_ROUTE_LIMITS[name] : undefined,
    );
    if (value !== undefined) defaults[name] = value;
  }
  return defaults;
}

/** The Route's leaf stands in first; turned off, it leaves no default. */
function ruleLimitDefault(
  routeLeaf: number | "off" | undefined,
  openDefault: number | undefined,
): number | undefined {
  if (routeLeaf === "off") return undefined;
  return routeLeaf ?? openDefault;
}
