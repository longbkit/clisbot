// Fusion-owned host adapter for `src/plugin-sdk/session-store-runtime.ts` (D-CORE-261).
//
// Upstream's barrel is OpenClaw's file-backed session store: it resolves the store
// path from config/env, loads and writes session entries, claims writers and runs
// maintenance. The Hub owns sessions and bindings in Fusion, so none of that is
// carried. The one helper the ported channel code calls is `resolveStorePath`, and
// it calls it only to derive a *cache scope* — the ported Telegram topic-name and
// message caches key their namespace off the store path so two agents on one host
// cannot read each other's cached topic names.
//
// Fusion keeps that scoping property without a store on disk: the returned value is
// a stable synthetic path, distinct per agent id, so the same call sites keep the
// same isolation. Nothing reads or writes this path.

const FUSION_SESSION_STORE_ROOT = "fusion:session-store";

/**
 * Resolves the session store path a cache scope is derived from.
 *
 * `store` is upstream's configured store path and wins when set, so a host that
 * does configure one keeps upstream's scoping exactly. `agentId` scopes the result
 * the way upstream's per-agent store selection does.
 */
export function resolveStorePath(
  store?: unknown,
  options?: { agentId?: string; env?: NodeJS.ProcessEnv },
): string {
  const base = (typeof store === "string" ? store.trim() : "") || FUSION_SESSION_STORE_ROOT;
  const agentId = options?.agentId?.trim();
  return agentId ? `${base}#${agentId}` : base;
}
