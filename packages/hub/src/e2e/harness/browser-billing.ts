/**
 * The E2E fixture for the Stripe plan catalog. Structurally matches `StripeCatalogSource` from
 * `src/billing/stripe-catalog-source.ts` without importing it — only `browser-child.ts` (this
 * harness's composition root, exempted the same way `src/index.ts` is) needs that import, so
 * the fixture itself stays outside the billing boundary. See the plan's "Testing Stripe"
 * section: no Stripe account, no network, fixtures only.
 */
export interface FixtureBillingProduct {
  id: string;
  name: string;
  active: boolean;
  metadata: Record<string, string>;
  marketingFeatures: string[];
}

export interface FixtureBillingPrice {
  id: string;
  productId: string;
  lookupKey: string | null;
  active: boolean;
  currency: string;
  unitAmount: number | null;
  interval: "month" | "year" | null;
}

export const FIXTURE_BILLING_PRODUCTS: readonly FixtureBillingProduct[] = [
  {
    id: "prod_fixture_free",
    name: "Free",
    active: true,
    metadata: {
      paseo_plan: "true",
      paseo_plan_slug: "free",
      ent_seats_max: "1",
      ent_can_invite: "false",
      ent_executions_monthly_limit: "100",
    },
    marketingFeatures: ["1 seat", "100 executions / month", "Community support"],
  },
  {
    id: "prod_fixture_solo",
    name: "Solo",
    active: true,
    metadata: {
      paseo_plan: "true",
      paseo_plan_slug: "solo",
      ent_seats_max: "unlimited",
      ent_can_invite: "true",
      ent_executions_monthly_limit: "2000",
    },
    marketingFeatures: ["Unlimited seats", "2,000 executions / month", "Email support"],
  },
  {
    id: "prod_fixture_team",
    name: "Team",
    active: true,
    metadata: {
      paseo_plan: "true",
      paseo_plan_slug: "team",
      ent_seats_max: "unlimited",
      ent_can_invite: "true",
      ent_executions_monthly_limit: "unlimited",
    },
    marketingFeatures: ["Unlimited seats", "Unlimited executions", "Priority support"],
  },
];

export const FIXTURE_BILLING_PRICES: readonly FixtureBillingPrice[] = [
  {
    id: "price_fixture_free_monthly",
    productId: "prod_fixture_free",
    lookupKey: "free_monthly",
    active: true,
    currency: "usd",
    unitAmount: 0,
    interval: "month",
  },
  {
    id: "price_fixture_free_annual",
    productId: "prod_fixture_free",
    lookupKey: "free_annual",
    active: true,
    currency: "usd",
    unitAmount: 0,
    interval: "year",
  },
  {
    id: "price_fixture_solo_monthly",
    productId: "prod_fixture_solo",
    lookupKey: "solo_monthly",
    active: true,
    currency: "usd",
    unitAmount: 2900,
    interval: "month",
  },
  {
    id: "price_fixture_solo_annual",
    productId: "prod_fixture_solo",
    lookupKey: "solo_annual",
    active: true,
    currency: "usd",
    unitAmount: 29000,
    interval: "year",
  },
  {
    id: "price_fixture_team_monthly",
    productId: "prod_fixture_team",
    lookupKey: "team_monthly",
    active: true,
    currency: "usd",
    unitAmount: 9900,
    interval: "month",
  },
  {
    id: "price_fixture_team_annual",
    productId: "prod_fixture_team",
    lookupKey: "team_annual",
    active: true,
    currency: "usd",
    unitAmount: 99000,
    interval: "year",
  },
];

/**
 * In-memory, mutable so `setProduct` can simulate a dashboard edit mid-test (see the
 * `billing-catalog` IPC command in `browser-child.ts`). The real webhook HTTP call still drives
 * the resync — this only changes what the next resync would read.
 */
export class FixtureStripeCatalogSource {
  private readonly products = new Map<string, FixtureBillingProduct>(
    FIXTURE_BILLING_PRODUCTS.map((product) => [product.id, product]),
  );
  private readonly prices = [...FIXTURE_BILLING_PRICES];

  setProduct(product: FixtureBillingProduct): void {
    this.products.set(product.id, product);
  }

  async listProducts(): Promise<FixtureBillingProduct[]> {
    return [...this.products.values()].filter(
      (product) => product.metadata["paseo_plan"] === "true",
    );
  }

  async listPrices(): Promise<FixtureBillingPrice[]> {
    return this.prices.map((price) => ({ ...price }));
  }
}

/**
 * The subscription state the fixture billing client re-reads. Structurally matches
 * `StripeSubscriptionState` from `src/billing/stripe-billing-client.ts` without importing it —
 * only `browser-child.ts` (this harness's composition root) crosses the billing boundary.
 */
export interface FixtureSubscriptionState {
  id: string;
  customerId: string;
  organizationId: string;
  priceId: string;
  quantity: number;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

const FIXTURE_SUBSCRIPTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/** The stable, per-organization fixture subscription id. The money test addresses it directly
 * when it delivers the signed subscription webhook, so this must match on both sides. */
export function fixtureSubscriptionId(organizationId: string): string {
  return `sub_fixture_${organizationId}`;
}

/**
 * The E2E fixture for Stripe customer/checkout/portal/subscription operations. No Stripe account,
 * no network — checkout "completes" instantly (the subscription exists by the time the browser
 * returns), and the tests then deliver real HMAC-signed webhooks that the billing runtime re-reads
 * through `getSubscription`.
 *
 * It preserves the invariant that makes the money path testable: an organization has exactly one
 * Stripe subscription for its lifetime, and its price only ever changes through
 * `changeSubscriptionPrice`. `createCheckoutSession` is therefore idempotent for the initial
 * subscription (a repeated first-checkout collapses onto the one subscription rather than a
 * second), and it never rewrites the price of an existing subscription. So if a plan change ever
 * regressed to routing through checkout instead of `changeSubscriptionPrice`, the price would not
 * move, and the plan-change assertions in billing-subscription/billing-downgrade would fail —
 * which is the whole point of modeling Stripe faithfully here.
 */
export class FixtureStripeBillingClient {
  private readonly subscriptions = new Map<string, FixtureSubscriptionState>();

  async ensureCustomer(input: { organizationId: string }): Promise<string> {
    return `cus_fixture_${input.organizationId}`;
  }

  async createCheckoutSession(input: {
    organizationId: string;
    customerId: string;
    priceId: string;
    quantity: number;
    successUrl: string;
  }): Promise<{ url: string }> {
    const id = fixtureSubscriptionId(input.organizationId);
    // Idempotent initial subscription: if one already exists, checkout does not open a second or
    // rewrite its price. A price change must go through changeSubscriptionPrice.
    if (!this.subscriptions.has(id)) {
      this.subscriptions.set(id, {
        id,
        customerId: input.customerId,
        organizationId: input.organizationId,
        priceId: input.priceId,
        quantity: input.quantity,
        status: "active",
        currentPeriodEnd: new Date(Date.now() + FIXTURE_SUBSCRIPTION_PERIOD_MS),
        cancelAtPeriodEnd: false,
      });
    }
    return { url: `/test/stripe-checkout?success=${encodeURIComponent(input.successUrl)}` };
  }

  async changeSubscriptionPrice(input: { subscriptionId: string; priceId: string }): Promise<void> {
    const subscription = this.find(input.subscriptionId);
    if (subscription === undefined) {
      throw new Error(`fixture subscription not found: ${input.subscriptionId}`);
    }
    // A plan change updates the existing subscription's item in place — same id, new price,
    // quantity carried over.
    subscription.priceId = input.priceId;
    subscription.status = "active";
  }

  async reportSeatQuantity(input: { subscriptionId: string; quantity: number }): Promise<void> {
    const subscription = this.find(input.subscriptionId);
    if (subscription === undefined) {
      throw new Error(`fixture subscription not found: ${input.subscriptionId}`);
    }
    subscription.quantity = input.quantity;
  }

  async createBillingPortalSession(input: { returnUrl: string }): Promise<{ url: string }> {
    // No hosted portal to stand in for — the fixture just returns the user to the dashboard.
    return { url: input.returnUrl };
  }

  async getSubscription(subscriptionId: string): Promise<FixtureSubscriptionState | undefined> {
    const subscription = this.find(subscriptionId);
    return subscription === undefined ? undefined : { ...subscription };
  }

  /**
   * Test-only (not part of `StripeBillingClient`): stand in for a portal cancellation by moving
   * the organization's subscription to `canceled`. The caller then delivers the signed
   * customer.subscription.deleted webhook, which reconciliation reads and stamps Free from.
   */
  cancelSubscription(organizationId: string): boolean {
    const subscription = this.subscriptions.get(fixtureSubscriptionId(organizationId));
    if (subscription === undefined) return false;
    subscription.status = "canceled";
    subscription.cancelAtPeriodEnd = false;
    return true;
  }

  /** Test-only: the seat quantity Stripe was last told to bill — what the seat-quantity E2E
   * asserts. Null when the organization has no fixture subscription. */
  reportedSeatQuantity(organizationId: string): number | null {
    return this.subscriptions.get(fixtureSubscriptionId(organizationId))?.quantity ?? null;
  }

  private find(subscriptionId: string): FixtureSubscriptionState | undefined {
    for (const state of this.subscriptions.values()) {
      if (state.id === subscriptionId) return state;
    }
    return undefined;
  }
}
