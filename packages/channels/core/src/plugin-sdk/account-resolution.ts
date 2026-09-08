// upstream: src/plugin-sdk/account-resolution.ts@5d8067a4483
/**
 * Public SDK subpath for account id normalization and account matching helpers.
 */
export {
  createAccountListHelpers,
  hasConfiguredAccountValue,
  listCombinedAccountIds,
  resolveListedDefaultAccountId,
} from "../channels/plugins/account-helpers.js";
export {
  normalizeAccountId,
  normalizeOptionalAccountId,
  DEFAULT_ACCOUNT_ID,
} from "../routing/account-id.js";

export type { OpenClawConfig } from "../config/types.openclaw.channels.js";
export { resolveAccountEntry, resolveNormalizedAccountEntry } from "../routing/account-lookup.js";
// D-CORE-240: upstream's barrel also re-exports `normalizeE164`,
// `resolveMergedAccountConfig` and `resolveUserPath` from
// `src/routing/account-core.ts`, a host-side account/session-key module the
// port stops at. The listed helpers live in `channels/plugins/account-helpers.ts`
// and `routing/account-id.ts` upstream and are re-exported from there.

// Slice 15 addition (Feishu vertical port): the ported Feishu policy resolver
// merges a per-account config over the channel defaults. Same upstream barrel,
// same source module (`src/plugin-sdk/account-core.ts` → the carried
// `src/config/channel-account-config.ts`).
export { resolveMergedAccountConfig } from "../config/channel-account-config.js";
