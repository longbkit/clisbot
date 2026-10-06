// Fusion-owned boundary for `src/plugin-sdk/allow-from.ts` (D-CORE-249).
//
// Upstream's barrel is the whole inbound admission surface (pairing, access
// groups, allowlist resolution summaries, chat-target prefixes). The Hub owns
// inbound admission in Fusion (goal slices 1-3), so only the compiled-allowlist
// matcher the ported Slack channel-policy reader calls is carried, plus the
// config-precedence helpers already ported in `channels/allow-from.ts`.
import { normalizeStringEntries } from "../normalization-core/string-normalization.js";
export type {
  AllowlistMatch,
  AllowlistMatchSource,
  CompiledAllowlist,
} from "../channels/allowlist-match.js";
export {
  compileAllowlist,
  formatAllowlistMatchMeta,
  resolveAllowlistCandidates,
  resolveAllowlistMatchByCandidates,
  resolveAllowlistMatchSimple,
  resolveCompiledAllowlistMatch,
} from "../channels/allowlist-match.js";
export {
  firstDefined,
  isSenderIdAllowed,
  mergeDmAllowFromSources,
  resolveGroupAllowFromSources,
} from "../channels/allow-from.js";

// WhatsApp port addition: the ported WhatsApp target normalizer canonicalizes
// allowlist entries through its own E.164/JID parser. Same upstream barrel; the
// function is upstream's own body, verbatim.
/** Normalize allowlist entries through a channel-provided parser or canonicalizer. */
export function formatNormalizedAllowFromEntries(params: {
  /** Raw allowlist entries from config or channel-specific overrides. */
  allowFrom: Array<string | number>;
  /** Channel-specific canonicalizer; empty results are omitted. */
  normalizeEntry: (entry: string) => string | undefined | null;
}): string[] {
  return normalizeStringEntries(params.allowFrom)
    .map((entry) => params.normalizeEntry(entry))
    .filter((entry): entry is string => Boolean(entry));
}
