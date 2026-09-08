// Fusion-owned boundary for `src/infra/outbound/send-deps.ts` (D-CORE-207).
//
// Upstream injects the whole outbound send stack (channel senders, media
// loaders, session context, receipts) through this record. The Hub owns
// outbound dispatch in Fusion; the ported channel types keep the name only.
export type OutboundSendDeps = Record<string, unknown>;

// Slice 10b addition (Slack outbound-adapter port): the ported adapter reads its
// own send function out of the dependency bag. Upstream's resolver and its
// legacy-key builder are carried verbatim from the same source module; the bag
// itself stays the opaque host record above.

/**
 * Builds historical dependency keys for channel send functions.
 */
export function resolveLegacyOutboundSendDepKeys(channelId: string): string[] {
  const compact = channelId.replace(/[^a-z0-9]+/gi, "");
  if (!compact) {
    return [];
  }
  const pascal = compact.charAt(0).toUpperCase() + compact.slice(1);
  const keys = new Set<string>();
  keys.add(`send${pascal}`);
  if (pascal.startsWith("I") && pascal.length > 1) {
    keys.add(`sendI${pascal.slice(1)}`);
  }
  if (pascal.startsWith("Ms") && pascal.length > 2) {
    keys.add(`sendMS${pascal.slice(2)}`);
  }
  return [...keys];
}

/**
 * Extra historical keys to try after the normalized channel-derived keys.
 */
export type ResolveOutboundSendDepOptions = {
  legacyKeys?: readonly string[];
};

/**
 * Resolves a channel send dependency from modern channel IDs or legacy helper keys.
 */
export function resolveOutboundSendDep<T>(
  deps: OutboundSendDeps | null | undefined,
  channelId: string,
  options?: ResolveOutboundSendDepOptions,
): T | undefined {
  const dynamic = deps?.[channelId];
  if (dynamic !== undefined) {
    return dynamic as T;
  }
  const legacyKeys = [
    ...resolveLegacyOutboundSendDepKeys(channelId),
    ...(options?.legacyKeys ?? []),
  ];
  for (const legacyKey of legacyKeys) {
    const legacy = deps?.[legacyKey];
    if (legacy !== undefined) {
      return legacy as T;
    }
  }
  return undefined;
}
