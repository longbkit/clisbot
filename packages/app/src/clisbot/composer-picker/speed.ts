import type { AgentFeature } from "@clisbot/protocol/agent-types";

/**
 * Providers sell faster, dearer tiers under three shapes: Claude's and OMP's `fast_mode`
 * toggle, Codex's `service_tier` select and Cursor's `fast` select. The panel shows them as
 * at most three standard levels, Standard, Fast and Ultra fast, by what each tier means, and
 * only the levels the model offers. A tier that is none of them (Codex Flex, slower and
 * cheaper) keeps its own label as an extra option. Each option writes back the provider's own
 * feature id and value, so older apps and the daemon see the writes they always did.
 */
export type SpeedLevel = "standard" | "fast" | "ultra";

export interface SpeedOption {
  /** "standard", "fast", "ultra", or `tier:<id>` for a tier outside the levels. */
  key: string;
  level: SpeedLevel | null;
  /** The provider's label, for a tier outside the levels. */
  label: string;
  value: unknown;
  /** Fast and Ultra fast cost more than Standard. */
  costsMore: boolean;
}

export interface SpeedControl {
  featureId: string;
  /** Standard, Fast, Ultra fast in that order, then any other tier. */
  options: SpeedOption[];
  /** Null when the current value is none of the options. */
  selectedKey: string | null;
}

const SPEED_FEATURE_IDS = new Set(["fast_mode", "service_tier", "fast"]);
const AUTO_ACCEPT_FEATURE_ID = "auto_accept";
const STANDARD_TIER = /^(default|normal|standard|off|false|none)$/i;
const ULTRA_TIER = /ultra/i;
const FAST_TIER = /fast|priority|turbo|^on$|^true$/i;
const LEVEL_ORDER: readonly SpeedLevel[] = ["standard", "fast", "ultra"];

type SelectFeature = Extract<AgentFeature, { type: "select" }>;
type SelectOption = SelectFeature["options"][number];

function levelOption(level: SpeedLevel, tier: { id: string; label: string }): SpeedOption {
  return { key: level, level, label: tier.label, value: tier.id, costsMore: level !== "standard" };
}

function matches(pattern: RegExp, tier: SelectOption): boolean {
  return pattern.test(tier.id) || pattern.test(tier.label);
}

function findStandard(tiers: readonly SelectOption[]): SelectOption | undefined {
  return tiers.find((tier) => tier.isDefault) ?? tiers.find((tier) => STANDARD_TIER.test(tier.id));
}

/** Each level takes the first tier that means it; the rest stay as their own options. */
function selectOptions(feature: SelectFeature): SpeedOption[] {
  const standard = findStandard(feature.options);
  const rest = feature.options.filter((tier) => tier !== standard);
  const ultra = rest.find((tier) => matches(ULTRA_TIER, tier));
  const fast = rest.find((tier) => tier !== ultra && matches(FAST_TIER, tier));
  const byLevel: Record<SpeedLevel, SelectOption | undefined> = { standard, fast, ultra };
  const levels = LEVEL_ORDER.flatMap((level) => {
    const tier = byLevel[level];
    return tier ? [levelOption(level, tier)] : [];
  });
  const others = rest
    .filter((tier) => tier !== ultra && tier !== fast)
    .map<SpeedOption>((tier) => ({
      key: `tier:${tier.id}`,
      level: null,
      label: tier.label,
      value: tier.id,
      costsMore: false,
    }));
  return [...levels, ...others];
}

function toggleOptions(): SpeedOption[] {
  return [
    { key: "standard", level: "standard", label: "", value: false, costsMore: false },
    { key: "fast", level: "fast", label: "", value: true, costsMore: true },
  ];
}

function fromFeature(feature: AgentFeature): SpeedControl | null {
  const options = feature.type === "toggle" ? toggleOptions() : selectOptions(feature);
  // A model with a single tier has nothing to choose.
  if (options.length < 2) return null;
  const selected = options.find((option) => option.value === feature.value);
  return { featureId: feature.id, options, selectedKey: selected?.key ?? null };
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
