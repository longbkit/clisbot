import { z } from "zod";
import { reportFailure } from "../failures/index.js";
import type { BillingPlanPriceInterval, BillingPlanRecord } from "../db/types.js";
import { selectActivePlanPrice } from "./plan-prices.js";

/**
 * The public plan catalog: name, slug, prices by interval, marketing bullets. The entitlement
 * template never crosses this boundary — see the plan's public plans endpoint section.
 */
export interface PublicBillingPlan {
  slug: string;
  name: string;
  marketingFeatures: readonly string[];
  prices: Record<BillingPlanPriceInterval, PublicBillingPlanPrice | null>;
}

export interface PublicBillingPlanPrice {
  unitAmount: number;
  currency: string;
}

const billingPlanMarketingSchema = z.object({ features: z.array(z.string()) });

/**
 * Turns the catalog mirror into the plans a customer may buy. Two things are withheld: a plan the
 * sync deactivated, and `excludeSlug` — the internal entitlement record (see `FREE_PLAN_SLUG`),
 * which exists so provisioning and cancellation have a template to stamp, not so anyone can
 * purchase it. Withholding it here is what lets every consumer treat "the catalog" as "the offer".
 */
export function publicBillingPlans(
  records: readonly BillingPlanRecord[],
  excludeSlug: string,
): PublicBillingPlan[] {
  return records
    .filter((record) => record.active && record.slug !== excludeSlug)
    .map(publicBillingPlan);
}

function publicBillingPlan(record: BillingPlanRecord): PublicBillingPlan {
  return {
    slug: record.slug,
    name: record.name,
    marketingFeatures: billingPlanMarketingSchema.parse(record.marketing).features,
    prices: {
      monthly: activePriceForInterval(record, "monthly"),
      annual: activePriceForInterval(record, "annual"),
    },
  };
}

function activePriceForInterval(
  record: BillingPlanRecord,
  interval: BillingPlanPriceInterval,
): PublicBillingPlanPrice | null {
  // Exact `{slug}_{interval}` lookup-key identity, matching checkout. Ambiguous pricing (two active
  // prices for one key) is surfaced as "unavailable" and logged, never displayed as an arbitrary
  // amount the customer might not be charged.
  try {
    const price = selectActivePlanPrice(record.prices, record.slug, interval);
    return price === undefined ? null : { unitAmount: price.unitAmount, currency: price.currency };
  } catch (error) {
    reportFailure(
      error,
      { operation: "billing.catalog.price.select", component: "billing", provider: "stripe" },
      { kind: "conflict", diagnostic: { planSlug: record.slug, interval } },
    );
    return null;
  }
}
