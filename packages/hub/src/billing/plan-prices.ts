import type { BillingPlanPriceInterval, BillingPlanPriceRecord } from "../db/types.js";

/**
 * The lookup key a plan's price for an interval must carry: `{slug}_{interval}` — `solo_monthly`,
 * `team_annual`. This is catalog identity. Prices are selected by exact lookup key, never by "the
 * first active price for this interval", so a second active monthly price is a rejected ambiguity
 * rather than an arbitrary amount to charge or display.
 */
export function expectedLookupKey(slug: string, interval: BillingPlanPriceInterval): string {
  return `${slug}_${interval}`;
}

/** Thrown when more than one active price claims a plan/interval's lookup key. */
export class AmbiguousPlanPriceError extends Error {
  constructor(slug: string, interval: BillingPlanPriceInterval) {
    super(
      `plan ${slug} has multiple active ${interval} prices for lookup key ${expectedLookupKey(slug, interval)}`,
    );
    this.name = "AmbiguousPlanPriceError";
  }
}

/**
 * The single active price for a plan/interval, matched by exact `{slug}_{interval}` lookup key.
 * Undefined when none matches; throws `AmbiguousPlanPriceError` when more than one active price
 * claims the key — ambiguity is rejected, never silently resolved to the first.
 */
export function selectActivePlanPrice(
  prices: readonly BillingPlanPriceRecord[],
  slug: string,
  interval: BillingPlanPriceInterval,
): BillingPlanPriceRecord | undefined {
  const key = expectedLookupKey(slug, interval);
  const matches = prices.filter((price) => price.active && price.lookupKey === key);
  if (matches.length > 1) throw new AmbiguousPlanPriceError(slug, interval);
  return matches[0];
}
