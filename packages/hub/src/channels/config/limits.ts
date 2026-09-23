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

/** The limits a Route is enforced against: what it authored over the
 * open-audience defaults, which only an open-audience Route gets. */
export function routeLimits(route: {
  audienceRules: readonly CompiledAudienceRule[];
  limits?: ChannelLimits | undefined;
}): ResolvedLimits | undefined {
  const defaults = isOpenAudience(route.audienceRules) ? OPEN_AUDIENCE_ROUTE_LIMITS : undefined;
  return resolveLimits(route.limits, defaults);
}

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
