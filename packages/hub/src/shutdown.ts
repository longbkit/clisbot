// COMPAT(clisbot-control-plane): the Hub's signal-driven shutdown
// orchestration, extracted from `main()` so it can be driven with fakes.
//
// What it fixes (D-W4-05, live 2026-09-07): `process.once("SIGTERM", …)` ran
// an unbounded stop with no second-signal handler. When the stop did not
// finish, the process stayed up for minutes — still holding the embedded
// data-directory lock, so the replacement instance died on
// `acquireDataDirectoryLock` — and the `once` handler was already consumed, so
// only a SECOND signal (which nothing was listening for) could end it.
//
// The four rules this encodes:
//   1. The steps run in ORDER, and the first one stops admitting new work.
//   2. The whole shutdown is bounded; when the budget elapses the process
//      exits anyway rather than lingering half-stopped.
//   3. A second signal exits immediately — an operator who sends SIGTERM twice
//      always gets the process back.
//   4. `release` runs on EVERY path (clean, thrown, timed out) before the
//      exit, so a crash never leaves an exclusive resource claimed. The
//      unconditional exit is the backstop: `acquireDataDirectoryLock` treats a
//      lock whose owner pid is gone as stale, so a process that actually exits
//      can never block its own replacement.
import type { Logger } from "pino";
import { reportFailure } from "./failures/index.js";

/** Whole-shutdown budget. Past this the process exits regardless of progress. */
export const SHUTDOWN_BUDGET_MS = 20_000;
/** How long the timed-out path waits for `release` before exiting anyway. */
export const SHUTDOWN_RELEASE_GRACE_MS = 2_000;

/** One ordered shutdown step. `name` is what the operator sees in the log. */
export interface ShutdownStep {
  readonly name: string;
  run(): Promise<void>;
}

export interface ShutdownSequence {
  /** Run in order on the first signal; the first step stops admission. */
  readonly steps: readonly ShutdownStep[];
  /** Always run before the exit — clean, thrown, or timed out. */
  release(): Promise<void>;
}

/** Run `onElapsed` after `ms`; the returned function cancels it. */
export type ShutdownSchedule = (ms: number, onElapsed: () => void) => () => void;

export interface ShutdownOptions {
  sequence: ShutdownSequence;
  exit(code: number): void;
  budgetMs?: number;
  releaseGraceMs?: number;
  schedule?: ShutdownSchedule;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}

/**
 * Build the signal handler. Install it with `process.on` (not `once`): the
 * handler itself decides what a repeat signal means.
 */
export function createSignalShutdown(options: ShutdownOptions): (signal: string) => void {
  let shuttingDown = false;
  return (signal) => {
    if (shuttingDown) {
      options.logger?.warn(`${signal} while already shutting down — exiting now`);
      options.exit(1);
      return;
    }
    shuttingDown = true;
    options.logger?.info(`${signal} received — shutting down`);
    void runShutdown(options);
  };
}

async function runShutdown(options: ShutdownOptions): Promise<void> {
  const schedule = options.schedule ?? defaultSchedule;
  const budgetMs = options.budgetMs ?? SHUTDOWN_BUDGET_MS;
  let timedOut = false;
  const cancelBudget = schedule(budgetMs, () => {
    timedOut = true;
    options.logger?.error(`shutdown did not finish within ${budgetMs}ms — exiting anyway`);
    void releaseThenExit(options, schedule, 1);
  });
  const failed = await runSteps(options);
  cancelBudget();
  // The budget already started its own release + exit; a late completion of
  // the steps must not race a second exit against it.
  if (timedOut) return;
  await releaseThenExit(options, schedule, failed ? 1 : 0);
}

/** Run every step in order, stopping at the first failure. */
async function runSteps(options: ShutdownOptions): Promise<boolean> {
  for (const step of options.sequence.steps) {
    try {
      await step.run();
    } catch (error) {
      reportFailure(
        error,
        { operation: `server.shutdown.${step.name}`, component: "server" },
        options.logger === undefined ? {} : { logger: options.logger },
      );
      return true;
    }
  }
  return false;
}

/**
 * The always-run tail: release, then exit. The release is bounded too, so a
 * hung release cannot turn into the very lingering process this fixes.
 */
async function releaseThenExit(
  options: ShutdownOptions,
  schedule: ShutdownSchedule,
  code: number,
): Promise<void> {
  const graceMs = options.releaseGraceMs ?? SHUTDOWN_RELEASE_GRACE_MS;
  const released = options.sequence
    .release()
    .then(() => true)
    .catch((error: unknown) => {
      reportFailure(
        error,
        { operation: "server.shutdown.release", component: "server" },
        options.logger === undefined ? {} : { logger: options.logger },
      );
      return false;
    });
  const inTime = await Promise.race([released, elapsedAfter(schedule, graceMs)]);
  options.exit(code === 0 && inTime ? 0 : 1);
}

/** Resolves to `false` once `ms` has passed — the loser side of the race. */
function elapsedAfter(schedule: ShutdownSchedule, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    schedule(ms, () => resolve(false));
  });
}

function defaultSchedule(ms: number, onElapsed: () => void): () => void {
  const timer = setTimeout(onElapsed, ms);
  // The watchdog must not be the reason the process stays alive.
  timer.unref();
  return () => clearTimeout(timer);
}
