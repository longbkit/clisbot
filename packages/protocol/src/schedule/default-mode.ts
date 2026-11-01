/**
 * The mode a `new-agent` schedule runs in when nobody chose one. A run is a normal agent: its
 * approval requests reach the app like any agent's, so it starts in a mode that asks. That is the
 * provider's default mode unless that default runs without prompts (OMP's Full access), then the
 * provider's first mode that asks, never Plan, which only plans. A provider with no mode that asks
 * (Antigravity) gets none and runs its own default; one with no modes gets none.
 *
 * The daemon stores this at creation and resolves it again for a run whose schedule has none; the
 * app preselects it in the schedule form. A schedule runs without prompts only when someone picked
 * such a mode (Full access, Bypass, Allow all, Full auto-accept) on it.
 */
export interface ScheduleModeCandidate {
  id: string;
  isUnattended?: boolean;
}

const PLAN_MODE_ID = "plan";

function asks(mode: ScheduleModeCandidate): boolean {
  return mode.isUnattended !== true && mode.id !== PLAN_MODE_ID;
}

export function resolveScheduleDefaultModeId(
  modes: readonly ScheduleModeCandidate[],
  defaultModeId: string | null | undefined,
): string | undefined {
  const preferred = modes.find((mode) => mode.id === defaultModeId);
  if (preferred && asks(preferred)) return preferred.id;
  return modes.find(asks)?.id;
}
