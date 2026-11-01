import type { AgentFeature } from "@clisbot/protocol/agent-types";

/**
 * Three providers offer a faster, dearer tier under three shapes: Claude's and OMP's
 * `fast_mode` toggle, Codex's `service_tier` select and Cursor's `fast` select. The panel
 * shows one Standard | Fast control and writes the right feature id and value back. When a
 * provider has several faster tiers, Fast picks the fastest ("Ultra…" before "Fast").
 */
export type SpeedChoice = "standard" | "fast";

export interface SpeedControl {
  featureId: string;
  /** Null when the current value is neither, for example Codex's slower Flex tier. */
  selected: SpeedChoice | null;
  values: Record<SpeedChoice, unknown>;
}

const SPEED_FEATURE_IDS = new Set(["fast_mode", "service_tier", "fast"]);
const AUTO_ACCEPT_FEATURE_ID = "auto_accept";
const STANDARD_OPTION = /^(default|normal|standard|off|false|none)$/i;
const FASTEST_OPTION = [/ultra/i, /fast|priority|turbo|^on$|^true$/i];

type SelectFeature = Extract<AgentFeature, { type: "select" }>;

function pickStandard(feature: SelectFeature) {
  return (
    feature.options.find((option) => option.isDefault) ??
    feature.options.find((option) => STANDARD_OPTION.test(option.id)) ??
    feature.options[0]
  );
}

function pickFastest(feature: SelectFeature, standardId: string | undefined) {
  const candidates = feature.options.filter((option) => option.id !== standardId);
  for (const pattern of FASTEST_OPTION) {
    const match = candidates.find(
      (option) => pattern.test(option.id) || pattern.test(option.label),
    );
    if (match) return match;
  }
  return undefined;
}

function choiceFor(value: unknown, values: Record<SpeedChoice, unknown>): SpeedChoice | null {
  if (value === values.fast) return "fast";
  return value === values.standard ? "standard" : null;
}

function fromFeature(feature: AgentFeature): SpeedControl | null {
  if (feature.type === "toggle") {
    const values = { standard: false, fast: true };
    return { featureId: feature.id, selected: choiceFor(feature.value, values), values };
  }
  const standard = pickStandard(feature);
  const fast = pickFastest(feature, standard?.id);
  if (!standard || !fast) return null;
  const values = { standard: standard.id, fast: fast.id };
  return { featureId: feature.id, selected: choiceFor(feature.value, values), values };
}

export function resolveSpeedControl(features: readonly AgentFeature[]): SpeedControl | null {
  const feature = features.find((entry) => SPEED_FEATURE_IDS.has(entry.id));
  return feature ? fromFeature(feature) : null;
}

/**
 * Splits the agent's features between the speed control and the panel's More section.
 * Full auto-accept replaces the per-provider `auto_accept` toggle on hosts that offer it.
 */
export function resolvePanelFeatures(
  features: readonly AgentFeature[],
  options: { fullAutoAcceptSupported: boolean },
): { speed: SpeedControl | null; more: AgentFeature[] } {
  const speed = resolveSpeedControl(features);
  const more = features.filter((feature) => {
    if (speed && feature.id === speed.featureId) return false;
    return !(options.fullAutoAcceptSupported && feature.id === AUTO_ACCEPT_FEATURE_ID);
  });
  return { speed, more };
}
