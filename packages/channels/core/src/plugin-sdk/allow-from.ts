// Fusion-owned boundary for `src/plugin-sdk/allow-from.ts` (D-CORE-249).
//
// Upstream's barrel is the whole inbound admission surface (pairing, access
// groups, allowlist resolution summaries, chat-target prefixes). The Hub owns
// inbound admission in Fusion (goal slices 1-3), so only the compiled-allowlist
// matcher the ported Slack channel-policy reader calls is carried, plus the
// config-precedence helpers already ported in `channels/allow-from.ts`.
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
