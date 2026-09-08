// Fusion-owned host adapter for `src/sessions/session-key-utils.ts` (D-CORE-046).
//
// Upstream's module owns OpenClaw's whole session-key grammar: canonical folding
// with case-preserved opaque peer spans, a bounded normalization cache, cron run
// scopes, channel-key builders and inventory lookups. The ported normalizer uses
// exactly one predicate from it — a value shaped like a session key is not a
// transport destination — so the parse below carries upstream's function body over
// a plain lowercase fold instead of the cached opaque-peer normalizer.
import { normalizeOptionalString } from "../normalization-core/string-coerce.js";

export type ParsedAgentSessionKey = {
  agentId: string;
  rest: string;
};

/**
 * Parse agent-scoped session keys in a canonical, case-insensitive way.
 * Returned values are canonicalized for stable comparisons/routing while
 * preserving provider-owned opaque peer IDs.
 */
export function parseAgentSessionKey(
  sessionKey: string | undefined | null,
): ParsedAgentSessionKey | null {
  const raw = normalizeOptionalString(sessionKey)?.toLowerCase() ?? "";
  if (!raw) {
    return null;
  }
  if (!raw.startsWith("agent:")) {
    return null;
  }
  const agentIdEnd = raw.indexOf(":", "agent:".length);
  if (agentIdEnd === -1) {
    return null;
  }
  const agentId = normalizeOptionalString(raw.slice("agent:".length, agentIdEnd));
  const rest = raw.slice(agentIdEnd + 1);
  if (!agentId || !rest || rest.startsWith(":")) {
    return null;
  }
  return { agentId, rest };
}
