import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import type { Database, SyncBillingPlanInput } from "../db/types.js";
import { composeBilling, type BillingRuntime } from "./index.js";
import type { StripeCatalogSource } from "./stripe-catalog-source.js";
import type { StripeBillingClient, StripeSubscriptionState } from "./stripe-billing-client.js";

// provisioningEntitlement only reads the catalog mirror, so these ports are never called here.
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

function freePlan(overrides: Partial<SyncBillingPlanInput> = {}): SyncBillingPlanInput {
  return {
    id: "prod_free",
    slug: "free",
    name: "Free",
    template: {
      seats: { max: 1 },
      canInviteMembers: false,
      meters: { "executions.monthly": { limit: 0 } },
    },
    templateHash: "hash-free",
    marketing: { features: ["1 seat"] },
    active: true,
    prices: [],
    ...overrides,
  };
}

describe("BillingRuntime.provisioningEntitlement", () => {
  it("stamps the mirrored Free plan when one is active", async () => {
    const database = createMemoryDatabase();
    await database.syncBillingPlan(freePlan());

    const entitlement = await billingOver(database).provisioningEntitlement();

    assert.equal(entitlement.planId, "prod_free");
    assert.deepEqual(entitlement.granted, {
      seats: { max: 1 },
      canInviteMembers: false,
      meters: { "executions.monthly": { limit: 0 } },
    });
  });

  it("falls back to a conservative floor (not unlimited) when no Free plan is mirrored", async () => {
    const database = createMemoryDatabase();
    // A configured instance whose catalog carries only a paid plan — a misconfigured Stripe, or a
    // first boot before the Free plan synced. Provisioning must not fail open to unlimited.
    await database.syncBillingPlan(freePlan({ id: "prod_solo", slug: "solo", name: "Solo" }));

    const entitlement = await billingOver(database).provisioningEntitlement();

    assert.equal(entitlement.planId, null);
    assert.equal(entitlement.granted.seats.max, 1);
    assert.equal(entitlement.granted.canInviteMembers, false);
    assert.notEqual(entitlement.granted.meters["executions.monthly"].limit, null);
  });

  it("ignores an inactive Free plan and uses the fallback", async () => {
    const database = createMemoryDatabase();
    await database.syncBillingPlan(freePlan({ active: false }));

    const entitlement = await billingOver(database).provisioningEntitlement();

    assert.equal(entitlement.planId, null);
    assert.equal(entitlement.granted.seats.max, 1);
  });
});
