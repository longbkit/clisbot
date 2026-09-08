// upstream: src/utils/timer-delay.ts@5d8067a4483
// Timer delay helpers clamp delays to runtime-safe timeout values.
import { resolveSafeTimeoutDelayMs } from "../gateway-client/timeouts.js";

export {
  addSafeTimeoutDelayGraceMs,
  resolveSafeTimeoutDelayMs,
} from "../gateway-client/timeouts.js";

/** Wrapper around setTimeout that clamps unsafe or invalid delays before arming the timer. */
export function setSafeTimeout(
  callback: () => void,
  delayMs: number,
  opts?: { minMs?: number },
): NodeJS.Timeout {
  return setTimeout(callback, resolveSafeTimeoutDelayMs(delayMs, opts));
}
