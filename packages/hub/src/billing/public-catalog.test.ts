import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import type { Database, SyncBillingPlanInput } from "../db/types.js";
import { composeBilling, type BillingRuntime } from "./index.js";
import type { StripeCatalogSource } from "./stripe-catalog-source.js";
import type { StripeBillingClient, StripeSubscriptionState } from "./stripe-billing-client.js";

/**
 * The public catalog boundary. `free` is an internal entitlement record — the template a hosted
 * organization is stamped with before it pays and again after it cancels — not something a
 * customer can buy. Billing commits to that distinction here, so no consumer (the plans endpoint,
 * the billing overview, the picker) has to know the slug or re-derive the rule.
 */

const unusedCatalogSource: StripeCatalogSource = {
  listProducts: () => Promise.reject(new Error("unused")),
  listPrices: () => Promise.reject(new Error("unused")),
};
const unusedBillingClient: StripeBillingClient = {
  ensureCustomer: () => Promise.reject(new Error("unused")),
  listCustomerSubscriptions: () => Promise.reject(new Error("unused")),
  createCheckoutSession: () => Promise.reject(new Error("unused")),
  changeSubscriptionPrice: () => Promise.reject(new Error("unused")),
  reportSeatQuantity: () => Promise.reject(new Error("unused")),
  createBillingPortalSession: () => Promise.reject(new Error("unused")),
  getSubscription: (): Promise<StripeSubscriptionState | undefined> =>
    Promise.reject(new Error("unused")),
};

function billingOver(database: Database): BillingRuntime {
  return composeBilling({
    config: { stripeSecretKey: "sk_test_fake", stripeWebhookSecret: "whsec_fake" },
    database,
    catalogSource: unusedCatalogSource,
    billingClient: unusedBillingClient,
    seatUsage: () => Promise.resolve(0),
  });
}

const internalFreePlan: SyncBillingPlanInput = {
  id: "prod_free",
  slug: "free",
  name: "Free",
  template: {
    seats: { max: 1 },
    canInviteMembers: false,
    meters: { "executions.monthly": { limit: 0 } },
  },
  templateHash: "hash-free",
  marketing: { features: ["0 executions / month"] },
  active: true,
  prices: [
    {
      id: "price_free_monthly",
      lookupKey: "free_monthly",
      interval: "monthly",
      unitAmount: 0,
      currency: "eur",
      active: true,
    },
  ],
};

const hostedPlan: SyncBillingPlanInput = {
  id: "prod_hosted",
  slug: "hosted",
  name: "Paseo Hub",
  template: {
    seats: { max: null },
    canInviteMembers: true,
    meters: { "executions.monthly": { limit: null } },
  },
  templateHash: "hash-hosted",
  marketing: { features: ["Unlimited daemons"] },
  active: true,
  prices: [
    {
      id: "price_hosted_monthly",
      lookupKey: "hosted_monthly",
      interval: "monthly",
      unitAmount: 1500,
      currency: "eur",
      active: true,
    },
  ],
};

describe("BillingRuntime.publicCatalog", () => {
  it("publishes the purchasable plan and withholds the internal free record", async () => {
    const database = createMemoryDatabase();
    await database.syncBillingPlan(internalFreePlan);
    await database.syncBillingPlan(hostedPlan);

    const catalog = await billingOver(database).publicCatalog();

    assert.deepEqual(catalog, [
      {
        slug: "hosted",
        name: "Paseo Hub",
        marketingFeatures: ["Unlimited daemons"],
        prices: { monthly: { unitAmount: 1500, currency: "eur" }, annual: null },
      },
    ]);
  });

  it("publishes nothing when the catalog carries only the internal free record", async () => {
    const database = createMemoryDatabase();
    await database.syncBillingPlan(internalFreePlan);

    assert.deepEqual(await billingOver(database).publicCatalog(), []);
  });

  it("withholds a plan the catalog sync deactivated", async () => {
    const database = createMemoryDatabase();
    await database.syncBillingPlan({ ...hostedPlan, active: false });

    assert.deepEqual(await billingOver(database).publicCatalog(), []);
  });

  it("never carries the entitlement template off the boundary", async () => {
    const database = createMemoryDatabase();
    await database.syncBillingPlan(hostedPlan);

    const [plan] = await billingOver(database).publicCatalog();

    assert.notEqual(plan, undefined);
    assert.deepEqual(Object.keys(plan!).sort(), ["marketingFeatures", "name", "prices", "slug"]);
  });

  it("prices an interval only from its exact lookup key, so a mismatched price reads unavailable", async () => {
    const database = createMemoryDatabase();
    await database.syncBillingPlan({
      ...hostedPlan,
      prices: [
        {
          id: "price_legacy",
          lookupKey: "hub_monthly",
          interval: "monthly",
          unitAmount: 900,
          currency: "eur",
          active: true,
        },
      ],
    });

    const [plan] = await billingOver(database).publicCatalog();

    assert.deepEqual(plan?.prices, { monthly: null, annual: null });
  });
});
