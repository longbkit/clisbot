/**
 * The bounded wait on one account's monitor during teardown.
 *
 * Stopping an account aborts its signal and then waits for the vertical's
 * gateway to return, because a replacement account must never overlap the old
 * one's socket or poll handlers. That wait used to be unbounded, and a monitor
 * that does not honour the abort promptly turned a stop into a hang: on
 * SIGTERM the Hub's first shutdown step is the runtime stop, so one lingering
 * socket spent the whole shutdown budget and the process was killed by its own
 * watchdog with the data-directory lock still held (`shutdown.ts`).
 *
 * A monitor gets a grace window instead. Past it the teardown continues and
 * says so: an account whose gateway outlives its stop is a fact an operator
 * needs in the log, not a reason to keep the process alive.
 */

/** Per-account grace. Well under `SHUTDOWN_BUDGET_MS`, so several lingering
 * accounts still leave the shutdown room to finish. */
export const MONITOR_STOP_GRACE_MS = 3_000;

/** Run `onElapsed` after `ms`; the returned function cancels it. */
export type MonitorStopSchedule = (ms: number, onElapsed: () => void) => () => void;

export interface AwaitMonitorExitOptions {
  graceMs?: number;
  schedule?: MonitorStopSchedule;
  /** Called once when the grace elapsed before the monitor returned. */
  onLingering?: () => void;
}

/**
 * Wait for `monitor` to settle, at most `graceMs`. Returns true when it
 * returned in time — false means the gateway is still running and the caller
 * is continuing without it.
 */
export async function awaitMonitorExit(
  monitor: Promise<unknown> | undefined,
  options: AwaitMonitorExitOptions = {},
): Promise<boolean> {
  if (monitor === undefined) return true;
  const schedule = options.schedule ?? defaultSchedule;
  let cancel: (() => void) | undefined;
  const elapsed = new Promise<false>((resolve) => {
    cancel = schedule(options.graceMs ?? MONITOR_STOP_GRACE_MS, () => resolve(false));
  });
  const settled = await Promise.race([monitor.then(() => true), elapsed]);
  cancel?.();
  if (!settled) options.onLingering?.();
  return settled;
}

function defaultSchedule(ms: number, onElapsed: () => void): () => void {
  const timer = setTimeout(onElapsed, ms);
  // The grace timer must not be the reason the process stays alive.
  timer.unref?.();
  return () => clearTimeout(timer);
}
