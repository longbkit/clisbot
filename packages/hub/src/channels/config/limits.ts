// Channel limits as the runtime reads them: authored leaves folded over the
// scope's defaults, `off` and unset-without-default dropped. What is left is
// only the limits that apply, as numbers — no leaf means no limit.
// docs/audits/2026-09-18-channel-chat-authority-and-limits.md#limits

import { isOpenAudience, type CompiledAudienceRule } from "./audience.js";
import {
  CHANNEL_LIMIT_NAMES,
  OPEN_AUDIENCE_ROUTE_LIMITS,
  type AccountLimits,
  type ChannelLimitName,
  type ChannelLimits,
} from "./schema.js";

export type ResolvedLimits = Partial<Record<ChannelLimitName, number>>;

/** The Bot's limits and the limits each of its Conversations gets. */
export interface CompiledAccountLimits {
  bot?: ResolvedLimits;
  perConversation?: ResolvedLimits;
}

export function resolveLimits(
  authored: ChannelLimits | undefined,
  defaults?: Readonly<ResolvedLimits>,
): ResolvedLimits | undefined {
  const resolved: ResolvedLimits = {};
  for (const name of CHANNEL_LIMIT_NAMES) {
    const value = authored?.[name] ?? defaults?.[name];
    if (typeof value === "number") resolved[name] = value;
  }
  return Object.keys(resolved).length === 0 ? undefined : resolved;
}

/**
 * A Route's limits: only what the configurator authored. The open-audience
 * defaults are applied where the limits are READ (`routeLimits`), not compiled
 * in — a Route's compiled block is hashed into `routeFingerprint`, so a
 * default baked in here would rewrite every open-audience Route's fingerprint
 * the day a default moves (the same rule as the conversation leaves,
 * `config/conversation.ts`).
 */
export function compileRouteLimits(authored: ChannelLimits | undefined): {
  limits?: ChannelLimits;
} {
  // The AUTHORED block, not resolved numbers: `off` has to survive to the read
  // point, or a leaf the configurator turned off would take the default back.
  return authored === undefined || Object.keys(authored).length === 0 ? {} : { limits: authored };
}

/**
 * The limits a Route is enforced against as a whole: only what it authored.
 * The open-audience defaults are an Anyone rule's (`ruleLimits`), so a Member
 * on a Route that also lets strangers in is not held to them
 * (docs/audits/2026-10-05-routes-and-rules.md#limits).
 */
export function routeLimits(route: {
  limits?: ChannelLimits | undefined;
}): ResolvedLimits | undefined {
  return resolveLimits(route.limits);
}

/**
 * The limits one rule is enforced against: its own leaf, else the Route's
 * authored leaf, else, for a rule that lets anyone in, the open-audience
 * default. The Route's leaf stands in before the default because it always
 * did: a Route that raised or turned off a default for strangers before rules
 * carried limits keeps exactly that, with nothing to migrate.
 */
export function ruleLimits(
  route: { limits?: ChannelLimits | undefined },
  rule: CompiledAudienceRule,
): ResolvedLimits | undefined {
  const open = isOpenAudience([rule]);
  const resolved: ResolvedLimits = {};
  for (const name of RULE_LIMIT_NAMES) {
    const value =
      rule.limits?.[name] ??
      route.limits?.[name] ??
      (open ? OPEN_AUDIENCE_ROUTE_LIMITS[name] : undefined);
    if (typeof value === "number") resolved[name] = value;
  }
  return Object.keys(resolved).length === 0 ? undefined : resolved;
}

/** The limits a rule can carry: all but the bot's own posting rate. */
const RULE_LIMIT_NAMES = CHANNEL_LIMIT_NAMES.filter(
  (name): name is Exclude<ChannelLimitName, "messagesSentPerMinute"> =>
    name !== "messagesSentPerMinute",
);

export function compileAccountLimits(authored: AccountLimits | undefined): {
  limits?: CompiledAccountLimits;
} {
  if (authored === undefined) return {};
  const { perConversation, ...own } = authored;
  const bot = resolveLimits(own);
  const conversation = resolveLimits(perConversation);
  if (bot === undefined && conversation === undefined) return {};
  return {
    limits: {
      ...(bot === undefined ? {} : { bot }),
      ...(conversation === undefined ? {} : { perConversation: conversation }),
    },
  };
}
