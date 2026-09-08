// upstream: src/plugin-sdk/routing.ts@5d8067a4483
// Account/session routing helpers for channel plugins.
export { isAcpSessionKey, normalizeAccountId } from "../routing/session-key.js";
// D-CORE-228: the upstream barrel also re-exports the account lookup table, the
// binding resolver, `resolveAgentRoute`, the default-account warnings and the
// outbound base-session-key/thread-id helpers. Fusion's Hub owns routing: it
// resolves the account and agent before a send reaches the vertical.

// Slice 10b addition (Slack accounts port): the per-account config entry lookup
// from `src/routing/account-lookup.ts`, the same source upstream's barrel uses.
export { resolveAccountEntry } from "../routing/account-lookup.js";

// Slice 13 addition (Discord vertical port): the ported Discord token and
// directory-cache modules read the default account id from this barrel.
export { DEFAULT_ACCOUNT_ID } from "../routing/account-id.js";
