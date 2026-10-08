import type { ScheduleCadence, StoredSchedule } from "@clisbot/protocol/schedule/types";
import { runLimitErrorForUpdate } from "@clisbot/protocol/schedule/run-limit";
import { parseMaxRuns } from "./max-runs";

export interface ScheduleDraft {
  name: string;
  prompt: string;
  maxRuns: string;
  cadence: ScheduleCadence;
}

export function draftFromSchedule(schedule: StoredSchedule): ScheduleDraft {
  return {
    name: schedule.name ?? "",
    prompt: schedule.prompt,
    maxRuns: schedule.maxRuns == null ? "" : String(schedule.maxRuns),
    cadence: storedCadence(schedule.cadence),
  };
}

/**
 * The daemon reads a cron without a timezone as UTC (`schedule/cron.ts`); the cadence editor
 * would otherwise show it, and save it, in the device's timezone.
 */
function storedCadence(cadence: ScheduleCadence): ScheduleCadence {
  return cadence.type === "cron" && !cadence.timezone ? { ...cadence, timezone: "UTC" } : cadence;
}

/** The update a draft asks for, or null when nothing the sheet owns changed. */
export function scheduleDraftPatch(schedule: StoredSchedule, draft: ScheduleDraft) {
  const name = draft.name.trim() || null;
  const prompt = draft.prompt.trim();
  const maxRuns = parseMaxRuns(draft.maxRuns);
  const cadenceChanged =
    draft.cadence.type === "cron" &&
    JSON.stringify(draft.cadence) !== JSON.stringify(storedCadence(schedule.cadence));
  const patch = {
    ...(name !== (schedule.name ?? null) ? { name } : {}),
    ...(prompt && prompt !== schedule.prompt ? { prompt } : {}),
    ...(maxRuns !== (schedule.maxRuns ?? null) ? { maxRuns } : {}),
    ...(cadenceChanged && draft.cadence.type === "cron" ? { cadence: draft.cadence } : {}),
  };
  return Object.keys(patch).length > 0 ? patch : null;
}

/** The patch would leave the schedule repeating within the day without Max runs. */
export function patchMissesMaxRuns(
  schedule: StoredSchedule,
  patch: ReturnType<typeof scheduleDraftPatch>,
): boolean {
  return patch !== null && runLimitErrorForUpdate(schedule, patch) !== null;
}
