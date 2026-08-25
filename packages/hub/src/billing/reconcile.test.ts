import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "vitest";
import { createMemoryDatabase } from "../db/memory.js";
import type { Database } from "../db/types.js";
import { normalizeStoredEntitlements } from "../entitlements/catalog.js";
import { composeBilling, type BillingRuntime } from "./index.js";
import type {
  StripeCatalogPrice,
  StripeCatalogProduct,
  StripeCatalogSource,
} from "./stripe-catalog-source.js";
import type {
  ChangeSubscriptionPriceInput,
  ReportSeatQuantityInput,
  StripeBillingClient,
  StripeSubscriptionState,
} from "./stripe-billing-client.js";

// The reconciliation half of the money path: a subscription webhook converges the organization's
// entitlements onto the subscription's live state, idempotently, and stamps Free when it ends.
// Signature verification runs for real (HMAC over `${timestamp}.${payload}` with the webhook
// secret), the same scheme Stripe uses, so nothing here mocks the SDK.

const WEBHOOK_SECRET = "whsec_reconcile_test";

const FREE_PRODUCT = "prod_free";
const SOLO_PRODUCT = "prod_solo";
const TEAM_PRODUCT = "prod_team";
const FREE_PRICE = "price_free_monthly";
const SOLO_PRICE = "price_solo_monthly";
const TEAM_PRICE = "price_team_monthly";

const PRODUCTS: StripeCatalogProduct[] = [
  {
    id: FREE_PRODUCT,
    name: "Free",
    active: true,
    metadata: {
      paseo_plan: "true",
      paseo_plan_slug: "free",
      ent_seats_max: "1",
      ent_can_invite: "false",
      ent_executions_monthly_limit: "100",
    },
    marketingFeatures: [],
  },
  {
    id: SOLO_PRODUCT,
    name: "Solo",
    active: true,
    metadata: {
      paseo_plan: "true",
      paseo_plan_slug: "solo",
      ent_seats_max: "unlimited",
      ent_can_invite: "true",
      ent_executions_monthly_limit: "2000",
    },
    marketingFeatures: [],
  },
  {
    id: TEAM_PRODUCT,
    name: "Team",
    active: true,
    metadata: {
      paseo_plan: "true",
      paseo_plan_slug: "team",
      ent_seats_max: "unlimited",
      ent_can_invite: "true",
      ent_executions_monthly_limit: "unlimited",
    },
    marketingFeatures: [],
  },
];

function price(id: string, productId: string, lookupKey: string): StripeCatalogPrice {
  return {
    id,
    productId,
    lookupKey,
    active: true,
    currency: "usd",
    unitAmount: 0,
    interval: "month",
  };
}

const PRICES: StripeCatalogPrice[] = [
  price(FREE_PRICE, FREE_PRODUCT, "free_monthly"),
  price(SOLO_PRICE, SOLO_PRODUCT, "solo_monthly"),
  price(TEAM_PRICE, TEAM_PRODUCT, "team_monthly"),
];

class FakeCatalogSource implements StripeCatalogSource {
  async listProducts(): Promise<StripeCatalogProduct[]> {
    return PRODUCTS;
  }
  async listPrices(): Promise<StripeCatalogPrice[]> {
    return PRICES;
  }
}

/** A minimal Stripe-subscription server the reconciliation re-reads through. Tests mutate the
 * live state, then deliver a webhook; reconciliation reads the current state, never the payload. */
class FakeBillingClient implements StripeBillingClient {
  private readonly subscriptions = new Map<string, StripeSubscriptionState>();

  setSubscription(id: string, organizationId: string, priceId: string, status = "active"): void {
    this.subscriptions.set(id, {
      id,
      customerId: `cus_${organizationId}`,
      organizationId,
      priceId,
      quantity: 1,
      status,
      currentPeriodEnd: new Date("2030-01-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
    });
  }

  cancel(id: string): void {
    const state = this.subscriptions.get(id);
    if (state !== undefined) state.status = "canceled";
  }

  async ensureCustomer(): Promise<string> {
    throw new Error("unused");
  }
  async createCheckoutSession(): Promise<{ url: string }> {
    throw new Error("unused");
  }
  async changeSubscriptionPrice(input: ChangeSubscriptionPriceInput): Promise<void> {
    const state = this.subscriptions.get(input.subscriptionId);
    if (state === undefined) throw new Error("unused");
    state.priceId = input.priceId;
  }
  async reportSeatQuantity(input: ReportSeatQuantityInput): Promise<void> {
    const state = this.subscriptions.get(input.subscriptionId);
    if (state === undefined) throw new Error("unused");
    state.quantity = input.quantity;
  }
  async createBillingPortalSession(): Promise<{ url: string }> {
    throw new Error("unused");
  }
  async getSubscription(subscriptionId: string): Promise<StripeSubscriptionState | undefined> {
    const state = this.subscriptions.get(subscriptionId);
    return state === undefined ? undefined : { ...state };
  }
}

async function setup(): Promise<{
  database: Database;
  billingClient: FakeBillingClient;
  billing: BillingRuntime;
  seats: { count: number };
}> {
  const database = createMemoryDatabase();
  const billingClient = new FakeBillingClient();
  const seats = { count: 1 };
  const billing = composeBilling({
    config: { stripeSecretKey: "sk_test_fake", stripeWebhookSecret: WEBHOOK_SECRET },
    database,
    catalogSource: new FakeCatalogSource(),
    billingClient,
    seatUsage: () => Promise.resolve(seats.count),
  });
  await billing.syncCatalog();
  return { database, billingClient, billing, seats };
}

function subscriptionWebhook(type: string, subscriptionId: string): Request {
  const payload = JSON.stringify({
    id: `evt_${subscriptionId}_${type}`,
    type,
    data: { object: { id: subscriptionId, object: "subscription" } },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return new Request("http://hub.test/api/billing/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    },
    body: payload,
  });
}

async function grantedSeatsMax(database: Database, organizationId: string): Promise<number | null> {
  const row = await database.getOrganizationEntitlements(organizationId);
  if (row === undefined) throw new Error(`no entitlements for ${organizationId}`);
  return normalizeStoredEntitlements(row.granted).seats.max;
}

describe("subscription webhook reconciliation", () => {
  it("stamps the resolved plan and is idempotent under replay", async () => {
    const { database, billingClient, billing } = await setup();
    billingClient.setSubscription("sub_1", "org_1", SOLO_PRICE);

    const first = await billing.handleWebhook(
      subscriptionWebhook("customer.subscription.created", "sub_1"),
    );
    assert.equal(first.status, 200);
    assert.equal(await grantedSeatsMax(database, "org_1"), null); // Solo: unlimited seats
    const row = await database.getOrganizationEntitlements("org_1");
    assert.equal(row?.planId, SOLO_PRODUCT);
    assert.equal((await database.listEntitlementChanges("org_1", 10)).length, 1);

    const replay = await billing.handleWebhook(
      subscriptionWebhook("customer.subscription.updated", "sub_1"),
    );
    assert.equal(replay.status, 200);
    // No new stamp: the granted template and provenance are unchanged, so no second audit row.
    assert.equal((await database.listEntitlementChanges("org_1", 10)).length, 1);
  });

  it("re-stamps a plan change from the live subscription state", async () => {
    const { database, billingClient, billing } = await setup();
    billingClient.setSubscription("sub_1", "org_1", SOLO_PRICE);
    await billing.handleWebhook(subscriptionWebhook("customer.subscription.created", "sub_1"));

    await billingClient.changeSubscriptionPrice({ subscriptionId: "sub_1", priceId: TEAM_PRICE });
    const updated = await billing.handleWebhook(
      subscriptionWebhook("customer.subscription.updated", "sub_1"),
    );
    assert.equal(updated.status, 200);
    const row = await database.getOrganizationEntitlements("org_1");
    assert.equal(row?.planId, TEAM_PRODUCT);
  });

  it("stamps Free on terminal cancellation so paid entitlements do not survive", async () => {
    const { database, billingClient, billing } = await setup();
    billingClient.setSubscription("sub_1", "org_1", SOLO_PRICE);
    await billing.handleWebhook(subscriptionWebhook("customer.subscription.created", "sub_1"));
    assert.equal(await grantedSeatsMax(database, "org_1"), null); // Solo

    billingClient.cancel("sub_1");
    const deleted = await billing.handleWebhook(
      subscriptionWebhook("customer.subscription.deleted", "sub_1"),
    );
    assert.equal(deleted.status, 200);
    assert.equal(await grantedSeatsMax(database, "org_1"), 1); // Free caps seats
    assert.equal((await database.getOrganizationEntitlements("org_1"))?.planId, FREE_PRODUCT);
  });

  it("converges a late duplicate onto current live state instead of reverting", async () => {
    const { database, billingClient, billing } = await setup();
    billingClient.setSubscription("sub_1", "org_1", SOLO_PRICE);
    await billing.handleWebhook(subscriptionWebhook("customer.subscription.created", "sub_1"));

    // The plan moved to Team in Stripe (a change), and only afterwards does an older "created"
    // delivery arrive. Because reconciliation re-reads live state under the lock, the late event
    // stamps the current Team plan — it never reverts to the Solo its payload implied.
    await billingClient.changeSubscriptionPrice({ subscriptionId: "sub_1", priceId: TEAM_PRICE });
    const late = await billing.handleWebhook(
      subscriptionWebhook("customer.subscription.created", "sub_1"),
    );
    assert.equal(late.status, 200);
    assert.equal((await database.getOrganizationEntitlements("org_1"))?.planId, TEAM_PRODUCT);
  });

  it("asks Stripe to retry when the subscription price is not in the mirror", async () => {
    const { database, billingClient, billing } = await setup();
    billingClient.setSubscription("sub_1", "org_1", "price_not_mirrored");

    const response = await billing.handleWebhook(
      subscriptionWebhook("customer.subscription.created", "sub_1"),
    );
    assert.equal(response.status, 503);
    // Nothing was stamped: an unresolved active subscription must be revisited, not acknowledged.
    assert.equal(await database.getOrganizationEntitlements("org_1"), undefined);
  });

  it("reports the live seat count on demand and only when it changed", async () => {
    const { billingClient, billing, seats } = await setup();
    billingClient.setSubscription("sub_1", "org_1", SOLO_PRICE);
    await billing.handleWebhook(subscriptionWebhook("customer.subscription.created", "sub_1"));
    assert.equal((await billingClient.getSubscription("sub_1"))?.quantity, 1); // owner only

    seats.count = 3;
    await billing.reportSeatUsage("org_1");
    assert.equal((await billingClient.getSubscription("sub_1"))?.quantity, 3);

    // The reported quantity already matches the live count, so the subscription webhook echo
    // reconciles without re-reporting — no ping-pong.
    await billing.handleWebhook(subscriptionWebhook("customer.subscription.updated", "sub_1"));
    assert.equal((await billingClient.getSubscription("sub_1"))?.quantity, 3);
  });
});
