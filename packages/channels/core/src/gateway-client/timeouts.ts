// Fusion-owned boundary for `packages/gateway-client/src/timeouts.ts` (D-CORE-254).
//
// Upstream's module also owns the Gateway connect/challenge/preauth deadlines
// and their env overrides — Gateway client policy the port stops at. The two
// timer-clamp helpers the ported fetch-timeout builder calls are carried with
// upstream's bodies and doc comments.

/** Maximum delay Node timers can represent without overflow warnings. */
export const MAX_SAFE_TIMEOUT_DELAY_MS = 2_147_483_647;

/** Clamps arbitrary timer delays to Node's safe range and an optional floor. */
export function resolveSafeTimeoutDelayMs(delayMs: number, opts?: { minMs?: number }): number {
  const rawMinMs = opts?.minMs ?? 1;
  const minMs = Math.min(
    MAX_SAFE_TIMEOUT_DELAY_MS,
    Math.max(0, Number.isFinite(rawMinMs) ? Math.floor(rawMinMs) : 1),
  );
  const candidateMs = Number.isFinite(delayMs) ? Math.floor(delayMs) : minMs;
  return Math.min(MAX_SAFE_TIMEOUT_DELAY_MS, Math.max(minMs, candidateMs));
}

/** Adds grace time while preserving safe timer bounds if inputs overflow or are invalid. */
export function addSafeTimeoutDelayGraceMs(
  delayMs: number,
  graceMs: number,
  opts?: { minMs?: number },
): number {
  if (!Number.isFinite(delayMs) || !Number.isFinite(graceMs)) {
    return resolveSafeTimeoutDelayMs(MAX_SAFE_TIMEOUT_DELAY_MS, opts);
  }
  const withGrace = delayMs + graceMs;
  return resolveSafeTimeoutDelayMs(
    Number.isFinite(withGrace) ? withGrace : MAX_SAFE_TIMEOUT_DELAY_MS,
    opts,
  );
}
