/**
 * Which speed settings cost more, for `agent.fast.use`. Providers sell faster, dearer tiers under
 * three feature ids: Claude's and OMP's `fast_mode` toggle, Codex's `service_tier` select and
 * Cursor's `fast` select. Tier ids are the provider's and new ones appear without notice, so the
 * check lists the cheap values and treats every other value as a faster tier: a tier nobody has
 * classified needs the privilege rather than slipping past it. The daemon's Managed Access and
 * the Hub's channel commands both judge with this one function.
 */

/** Codex tiers that cost no more than the standard one: the default, Flex (slower) and Auto. */
const CHEAP_SERVICE_TIERS: ReadonlySet<string> = new Set(["default", "standard", "flex", "auto"]);

/** A toggle or select that is off. Absent means the provider's default, which is off. */
const OFF_VALUES: ReadonlySet<unknown> = new Set([undefined, null, false, "false", "off"]);

/** True when `value` of `featureId` selects a tier that costs more than the standard one. */
export function isFasterTier(featureId: string, value: unknown): boolean {
  if (featureId === "fast_mode" || featureId === "fast") return !OFF_VALUES.has(value);
  if (featureId !== "service_tier") return false;
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || !CHEAP_SERVICE_TIERS.has(value.toLowerCase());
}

/** True when any feature value in a configuration selects a faster tier. */
export function usesFasterTier(
  featureValues: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return Object.entries(featureValues ?? {}).some(([featureId, value]) =>
    isFasterTier(featureId, value),
  );
}
