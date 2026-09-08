// Fusion-owned boundary for `src/plugin-sdk/global-singleton.ts` (D-CORE-243).
//
// Upstream also re-exports `createScopedExpiringIdCache` from
// `src/shared/scoped-expiring-id-cache.ts`; no ported file reads it yet.
/**
 * Public SDK subpath for process-wide singleton and scoped expiring cache helpers.
 */
export { resolveGlobalMap } from "../shared/global-singleton.js";
export { resolveGlobalSingleton } from "../shared/global-singleton.js";
