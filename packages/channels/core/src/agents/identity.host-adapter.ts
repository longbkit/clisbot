// Fusion-owned host adapter for `src/agents/identity.ts` (D-CORE-022).
//
// Upstream derives an agent display identity and a per-channel response prefix
// from OpenClaw's merged agent/channel/account config tree. Fusion's Hub owns
// agent identity and does not prefix channel replies, so both lookups report
// "nothing configured" and the send path keeps its unprefixed text.

/** The identity slice `message-action-send` reads: the display name only. */
export type IdentityConfig = { name?: string };

export function resolveAgentIdentity(
  _cfg: unknown,
  _agentId: string,
): IdentityConfig | undefined {
  return undefined;
}

export function resolveResponsePrefix(
  _cfg: unknown,
  _agentId: string,
  _opts?: { channel?: string; accountId?: string },
): string | undefined {
  return undefined;
}
