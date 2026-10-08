import type { ScheduleCadence } from "@clisbot/protocol/schedule/types";
import {
  runLimitError,
  runLimitErrorForUpdate,
  type ScheduleRunLimitChange,
} from "@clisbot/protocol/schedule/run-limit";

/**
 * Clisbot: a schedule that repeats more than once a day needs Max runs. Checked where requests
 * enter (the schedule RPCs and the agent tools), so schedules stored before the rule keep working
 * and the service itself stays upstream's.
 */
export function assertRunLimit(cadence: ScheduleCadence, maxRuns: number | null | undefined): void {
  const refusal = runLimitError(cadence, maxRuns);
  if (refusal) throw new Error(refusal);
}

/** The same for an update; reads the stored schedule only when the cadence or Max runs change. */
export async function assertRunLimitForUpdate(
  current: () => Promise<{ cadence: ScheduleCadence; maxRuns: number | null }>,
  change: ScheduleRunLimitChange,
): Promise<void> {
  if (change.cadence === undefined && change.maxRuns === undefined) return;
  const refusal = runLimitErrorForUpdate(await current(), change);
  if (refusal) throw new Error(refusal);
}
