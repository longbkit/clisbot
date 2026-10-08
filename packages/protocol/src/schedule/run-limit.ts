import { parseCronExpression } from "./cron-expression.js";
import type { ScheduleCadence } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Clisbot: a schedule that can run more than once a day must carry Max runs, so a short cadence
 * never runs unbounded (docs/audits/2026-10-06-conversation-schedules.md). An interval under a
 * day counts; so does a cron with more than one time of day. A daily or weekly time does not.
 */
export function runsMoreThanDaily(cadence: ScheduleCadence): boolean {
  if (cadence.type === "every") return cadence.everyMs < DAY_MS;
  let parsed;
  try {
    parsed = parseCronExpression(cadence.expression.trim());
  } catch {
    // The daemon refuses an invalid cron with its own error.
    return false;
  }
  const hours = countMatches(24, (hour) => parsed.hour.matches(hour));
  const minutes = countMatches(60, (minute) => parsed.minute.matches(minute));
  return hours * minutes > 1;
}

function countMatches(size: number, matches: (value: number) => boolean): number {
  let count = 0;
  for (let value = 0; value < size; value += 1) if (matches(value)) count += 1;
  return count;
}

export const RUN_LIMIT_REQUIRED_MESSAGE =
  "This schedule repeats more than once a day; set Max runs (maxRuns, --max-runs) so it cannot run without end.";

/** The refusal for a schedule that repeats more than once a day without a run limit, if any. */
export function runLimitError(
  cadence: ScheduleCadence,
  maxRuns: number | null | undefined,
): string | null {
  return runsMoreThanDaily(cadence) && !maxRuns ? RUN_LIMIT_REQUIRED_MESSAGE : null;
}

export interface ScheduleRunLimitChange {
  cadence?: ScheduleCadence;
  /** `null` clears the limit; absent leaves it. */
  maxRuns?: number | null;
}

/**
 * The refusal for an update. Only a change to the cadence or Max runs answers to the rule, so a
 * schedule stored without Max runs before the rule can still be renamed or moved.
 */
export function runLimitErrorForUpdate(
  current: { cadence: ScheduleCadence; maxRuns: number | null },
  change: ScheduleRunLimitChange,
): string | null {
  if (change.cadence === undefined && change.maxRuns === undefined) return null;
  return runLimitError(
    change.cadence ?? current.cadence,
    change.maxRuns !== undefined ? change.maxRuns : current.maxRuns,
  );
}
