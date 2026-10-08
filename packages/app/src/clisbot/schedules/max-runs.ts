import type { ScheduleCadence } from "@clisbot/protocol/schedule/types";
import { runLimitError } from "@clisbot/protocol/schedule/run-limit";

export function parseMaxRuns(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** The cadence repeats within the day and Max runs is empty, so the daemon would refuse it. */
export function missingMaxRuns(cadence: ScheduleCadence, raw: string): boolean {
  return runLimitError(cadence, parseMaxRuns(raw)) !== null;
}
