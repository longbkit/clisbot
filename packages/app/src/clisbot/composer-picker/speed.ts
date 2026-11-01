import type { AgentFeature } from "@clisbot/protocol/agent-types";
import { isFasterTier } from "@clisbot/protocol/speed-tier";
import { PROVIDER_AUTO_ACCEPT_FEATURE_ID } from "./mode-options";

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
  /**
   * The tier costs more than the standard one, judged as `agent.fast.use` judges it
   * (`@clisbot/protocol/speed-tier`): Fast and Ultra fast, and any tier nobody has classified.
   */
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
const STANDARD_TIER = /^(default|normal|standard|off|false|none)$/i;
const ULTRA_TIER = /ultra/i;
const FAST_TIER = /fast|priority|turbo|^on$|^true$/i;
const LEVEL_ORDER: readonly SpeedLevel[] = ["standard", "fast", "ultra"];

type SelectFeature = Extract<AgentFeature, { type: "select" }>;
/** An option before its cost is judged, from the value it writes. */
type TierOption = Omit<SpeedOption, "costsMore">;
type SelectOption = SelectFeature["options"][number];

function levelOption(level: SpeedLevel, tier: { id: string; label: string }): TierOption {
  return { key: level, level, label: tier.label, value: tier.id };
}

function matches(pattern: RegExp, tier: SelectOption): boolean {
  return pattern.test(tier.id) || pattern.test(tier.label);
}

function findStandard(tiers: readonly SelectOption[]): SelectOption | undefined {
  return tiers.find((tier) => tier.isDefault) ?? tiers.find((tier) => STANDARD_TIER.test(tier.id));
}

/** Each level takes the first tier that means it; the rest stay as their own options. */
function selectOptions(feature: SelectFeature): TierOption[] {
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
    .map<TierOption>((tier) => ({
      key: `tier:${tier.id}`,
      level: null,
      label: tier.label,
      value: tier.id,
    }));
  return [...levels, ...others];
}

function toggleOptions(): TierOption[] {
  return [
    { key: "standard", level: "standard", label: "", value: false },
    { key: "fast", level: "fast", label: "", value: true },
  ];
}

function fromFeature(feature: AgentFeature): SpeedControl | null {
  const tiers = feature.type === "toggle" ? toggleOptions() : selectOptions(feature);
  const options = tiers.map<SpeedOption>(({ key, level, label, value }) => ({
    key,
    level,
    label,
    value,
    costsMore: isFasterTier(feature.id, value),
  }));
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
    return !(options.fullAutoAcceptSupported && feature.id === PROVIDER_AUTO_ACCEPT_FEATURE_ID);
  });
  return { speed, more };
}
