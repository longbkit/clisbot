import StripeSDK from "stripe";
import type {
  StripeCatalogPrice,
  StripeCatalogProduct,
  StripeCatalogSource,
} from "./stripe-catalog-source.js";
import type {
  ChangeSubscriptionPriceInput,
  CreateBillingPortalSessionInput,
  CreateCheckoutSessionInput,
  EnsureCustomerInput,
  ReportSeatQuantityInput,
  StripeBillingClient,
  StripeSubscriptionState,
} from "./stripe-billing-client.js";

const PASEO_PLAN_METADATA_KEY = "paseo_plan";
const ORGANIZATION_REFERENCE_METADATA_KEY = "organizationId";
const LIST_PAGE_SIZE = 100;

/**
 * The real Stripe SDK behind `StripeCatalogSource`. Fetches every product/price via the List
 * API (not Search — Search has an indexing lag after a write, which would make the boot sync
 * racy right after a dashboard edit; List is strongly consistent) and filters client-side to
 * `metadata.paseo_plan=true`, matching the plan's "which products are Paseo plans" rule.
 *
 * Fetches products regardless of `active` so a product archived in the dashboard is mirrored
 * as inactive rather than silently vanishing from the fetch and going stale in our mirror.
 */
export function createStripeCatalogSource(stripeSecretKey: string): StripeCatalogSource {
  const stripe = new StripeSDK(stripeSecretKey);
  return {
    async listProducts(): Promise<StripeCatalogProduct[]> {
      const products: StripeCatalogProduct[] = [];
      for await (const product of stripe.products.list({ limit: LIST_PAGE_SIZE })) {
        if (product.metadata[PASEO_PLAN_METADATA_KEY] !== "true") continue;
        products.push({
          id: product.id,
          name: product.name,
          active: product.active,
          metadata: product.metadata,
          marketingFeatures: product.marketing_features.flatMap((feature) =>
            feature.name === undefined ? [] : [feature.name],
          ),
        });
      }
      return products;
    },
    async listPrices(): Promise<StripeCatalogPrice[]> {
      const prices: StripeCatalogPrice[] = [];
      for await (const price of stripe.prices.list({ limit: LIST_PAGE_SIZE })) {
        prices.push({
          id: price.id,
          productId: typeof price.product === "string" ? price.product : price.product.id,
          lookupKey: price.lookup_key,
          active: price.active,
          currency: price.currency,
          unitAmount: price.unit_amount,
          interval:
            price.recurring?.interval === "month" || price.recurring?.interval === "year"
              ? price.recurring.interval
              : null,
        });
      }
      return prices;
    },
  };
}

/**
 * The real Stripe SDK behind `StripeBillingClient`. Every subscription carries
 * `metadata.organizationId` so the webhook can resolve the reference on re-read without trusting
 * event ordering. `getSubscription` reads the period end off the first subscription item, where
 * the current Stripe API keeps it.
 */
export function createStripeBillingClient(stripeSecretKey: string): StripeBillingClient {
  const stripe = new StripeSDK(stripeSecretKey);
  return {
    async ensureCustomer(input: EnsureCustomerInput): Promise<string> {
      const customer = await stripe.customers.create(
        {
          ...(input.email === null ? {} : { email: input.email }),
          ...(input.name === null ? {} : { name: input.name }),
          metadata: { [ORGANIZATION_REFERENCE_METADATA_KEY]: input.organizationId },
        },
        // Keyed on the organization so two concurrent first-checkout attempts collapse onto one
        // customer instead of creating a duplicate — the customer half of "pending checkout
        // creation is idempotent".
        { idempotencyKey: `customer:${input.organizationId}` },
      );
      return customer.id;
    },
    async listCustomerSubscriptions(
      customerId: string,
    ): Promise<readonly StripeSubscriptionState[]> {
      const result: StripeSubscriptionState[] = [];
      for await (const subscription of stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: LIST_PAGE_SIZE,
      })) {
        const organizationId = subscription.metadata[ORGANIZATION_REFERENCE_METADATA_KEY];
        const item = subscription.items.data[0];
        if (organizationId !== undefined && item !== undefined)
          result.push(toSubscriptionState(subscription, organizationId, item));
      }
      return result;
    },
    async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ url: string }> {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: input.customerId,
          line_items: [{ price: input.priceId, quantity: input.quantity }],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          client_reference_id: input.organizationId,
          metadata: { [ORGANIZATION_REFERENCE_METADATA_KEY]: input.organizationId },
          subscription_data: input.trial
            ? {
                trial_period_days: 14,
                trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
                metadata: { [ORGANIZATION_REFERENCE_METADATA_KEY]: input.organizationId },
              }
            : { metadata: { [ORGANIZATION_REFERENCE_METADATA_KEY]: input.organizationId } },
          ...(input.trial ? { payment_method_collection: "if_required" } : {}),
        },
        {
          idempotencyKey: `checkout:${input.organizationId}:${input.priceId}:${input.trial ? "trial" : "paid"}`,
        },
      );
      if (session.url === null) throw new Error("Stripe checkout session has no redirect URL");
      return { url: session.url };
    },
    async changeSubscriptionPrice(input: ChangeSubscriptionPriceInput): Promise<void> {
      // A plan change updates the existing subscription's single item onto the new price — never a
      // second subscription. Stripe needs the item id, so retrieve first, then swap its price.
      const subscription = await stripe.subscriptions.retrieve(input.subscriptionId);
      const item = subscription.items.data[0];
      if (item === undefined) {
        throw new Error(`subscription ${input.subscriptionId} has no item to change`);
      }
      await stripe.subscriptions.update(input.subscriptionId, {
        items: [{ id: item.id, price: input.priceId }],
        proration_behavior: "create_prorations",
      });
    },
    async reportSeatQuantity(input: ReportSeatQuantityInput): Promise<void> {
      // Post-paid seat billing: set the item's quantity to the organization's live seat count.
      // The caller only calls this on a change, so the resulting subscription.updated echo carries
      // no delta and reconciliation converges without re-reporting.
      const subscription = await stripe.subscriptions.retrieve(input.subscriptionId);
      const item = subscription.items.data[0];
      if (item === undefined) {
        throw new Error(`subscription ${input.subscriptionId} has no item to report seats on`);
      }
      await stripe.subscriptions.update(input.subscriptionId, {
        items: [{ id: item.id, quantity: input.quantity }],
        proration_behavior: "create_prorations",
      });
    },
    async createBillingPortalSession(
      input: CreateBillingPortalSessionInput,
    ): Promise<{ url: string }> {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: session.url };
    },
    async getSubscription(subscriptionId: string): Promise<StripeSubscriptionState | undefined> {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const organizationId = subscription.metadata[ORGANIZATION_REFERENCE_METADATA_KEY];
      const item = subscription.items.data[0];
      if (organizationId === undefined || item === undefined) return undefined;
      return toSubscriptionState(subscription, organizationId, item);
    },
  };
}

function toSubscriptionState(
  subscription: StripeSDK.Subscription,
  organizationId: string,
  item: StripeSDK.SubscriptionItem,
): StripeSubscriptionState {
  return {
    id: subscription.id,
    customerId:
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    organizationId,
    priceId: item.price.id,
    quantity: item.quantity ?? 1,
    status: subscription.status,
    currentPeriodEnd: new Date(item.current_period_end * 1000),
    trialEnd: subscription.trial_end === null ? null : new Date(subscription.trial_end * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}
