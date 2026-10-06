// upstream: src/plugin-sdk/account-core.ts@5d8067a4483
// Account core contracts re-export config and account types used by plugin account flows.
// D-CORE-701: `OpenClawConfig` comes from the carried config graph
// (`config/types.openclaw.channels.ts`, D-CORE-003) rather than the full
// `config/config.ts`, and `pathExists` is not re-exported: upstream takes it from
// the `src/utils.ts` grab bag over `@openclaw/fs-safe`, and no ported caller
// reads it. `normalizeE164` / `resolveUserPath` come from the carried utils subset
// (`utils.host-adapter.ts`, D-CORE-061).
export type { OpenClawConfig } from "../config/types.openclaw.channels.js";

export { createAccountActionGate } from "../channels/plugins/account-action-gate.js";
export {
  createAccountListHelpers,
  describeAccountSnapshot,
  hasConfiguredAccountValue,
  listCombinedAccountIds,
  mergeAccountConfig,
  resolveListedDefaultAccountId,
  resolveMergedAccountConfig,
} from "../channels/plugins/account-helpers.js";
export { normalizeChatType } from "../channels/chat-type.js";
export { resolveAccountEntry, resolveNormalizedAccountEntry } from "../routing/account-lookup.js";
export {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  normalizeOptionalAccountId,
} from "../routing/session-key.js";
export { normalizeE164, resolveUserPath } from "../utils.host-adapter.js";
export { listConfiguredAccountIds } from "./account-configured-ids.js";

/** Resolve an account by id, then fall back to the default account when the primary lacks credentials. */
export function resolveAccountWithDefaultFallback<TAccount>(params: {
  accountId?: string | null;
  normalizeAccountId: (accountId?: string | null) => string;
  resolvePrimary: (accountId: string) => TAccount;
  hasCredential: (account: TAccount) => boolean;
  resolveDefaultAccountId: () => string;
}): TAccount {
  const hasExplicitAccountId = Boolean(params.accountId?.trim());
  const normalizedAccountId = params.normalizeAccountId(params.accountId);
  const primary = params.resolvePrimary(normalizedAccountId);
  if (hasExplicitAccountId || params.hasCredential(primary)) {
    return primary;
  }

  const fallbackId = params.resolveDefaultAccountId();
  if (fallbackId === normalizedAccountId) {
    return primary;
  }
  const fallback = params.resolvePrimary(fallbackId);
  if (!params.hasCredential(fallback)) {
    return primary;
  }
  return fallback;
}
