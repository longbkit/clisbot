import type { AgentMode } from "@clisbot/protocol/agent-types";

// Plan is always a mode (isPlanningAgentMode), never a feature.
export const FAST_MODE_FEATURE_ID = "fast_mode";
export const AUTO_ACCEPT_FEATURE_ID = "auto_accept";
export const SPEED_FEATURE_ID = "service_tier";

export function isPlanningAgentMode(mode: Pick<AgentMode, "id" | "colorTier">): boolean {
  return mode.colorTier === "planning" || mode.id === "plan" || mode.id.endsWith("#plan");
}

export function resolveNonPlanningModeId(
  modes: readonly AgentMode[],
  defaultModeId: string | null,
): string | null {
  const defaultMode = modes.find((mode) => mode.id === defaultModeId);
  if (defaultMode && !isPlanningAgentMode(defaultMode)) {
    return defaultMode.id;
  }
  return modes.find((mode) => !isPlanningAgentMode(mode))?.id ?? null;
}
