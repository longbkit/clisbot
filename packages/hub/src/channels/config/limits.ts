// Channel limits as the runtime reads them: authored leaves folded over the
// scope's defaults, `off` and unset-without-default dropped. What is left is
// only the limits that apply, as numbers — no leaf means no limit.
// docs/audits/2026-09-18-channel-chat-authority-and-limits.md#limits

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

/** A Route's limits; an open-audience Route starts from the conservative defaults. */
export function compileRouteLimits(
  authored: ChannelLimits | undefined,
  audience: "members" | "conversationParticipants",
): { limits?: ResolvedLimits } {
  const limits = resolveLimits(
    authored,
    audience === "conversationParticipants" ? OPEN_AUDIENCE_ROUTE_LIMITS : undefined,
  );
  return limits === undefined ? {} : { limits };
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
