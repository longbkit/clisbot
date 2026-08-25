/**
 * The narrow port `src/billing/` performs Stripe customer/checkout/portal/subscription
 * operations through. Production wires the real Stripe SDK (`stripe-client.ts`); the E2E harness
 * wires a fixture — see the plan's "Testing Stripe" section (no Stripe account, no network,
 * fixtures only). A caller never learns which one it got.
 *
 * This is deliberately not `@better-auth/stripe`: that plugin's checkout reaches
 * `stripe.checkout.sessions.create` with no seam narrower than the whole `Stripe` client, so the
 * money test could not run without mocking the SDK. Better Auth still owns auth, organizations,
 * sessions, and permissions; billing authorizes every reference through `OrganizationAccess`.
 */
export interface StripeBillingClient {
  /** The Stripe customer for an organization, created if it does not exist yet. */
  ensureCustomer(input: EnsureCustomerInput): Promise<string>;
  /** A Checkout Session for the organization's *first* subscription to `priceId`, carrying
   * `organizationId` in metadata so the subscription webhook can resolve the reference on re-read.
   * Only ever called when the organization has no subscription yet — a plan change goes through
   * `changeSubscriptionPrice`, never a second checkout. Returns its redirect URL. */
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ url: string }>;
  /** Move the organization's existing subscription onto `priceId` by updating its single item in
   * place. Stripe models a plan change as an update to the existing subscription, not a second
   * one, so this is the only path a change ever takes. */
  changeSubscriptionPrice(input: ChangeSubscriptionPriceInput): Promise<void>;
  /** Report the subscription's per-seat quantity (post-paid billing). Called only when the count
   * actually changed, so the `customer.subscription.updated` echo carries no further change and
   * cannot ping-pong with reconciliation. */
  reportSeatQuantity(input: ReportSeatQuantityInput): Promise<void>;
  /** A Billing Portal session — Stripe owns payment methods, invoices, and cancellation. */
  createBillingPortalSession(input: CreateBillingPortalSessionInput): Promise<{ url: string }>;
  /** Re-read the authoritative subscription state. The webhook is driven by this, never by the
   * event payload, so retries and out-of-order delivery converge on the same stamp. Undefined
   * when the subscription no longer exists. */
  getSubscription(subscriptionId: string): Promise<StripeSubscriptionState | undefined>;
}

export interface EnsureCustomerInput {
  organizationId: string;
  email: string | null;
  name: string | null;
}

export interface CreateCheckoutSessionInput {
  organizationId: string;
  customerId: string;
  priceId: string;
  /** The organization's seat count at checkout, so the subscription starts billed for its actual
   * seats rather than pinned at one. */
  quantity: number;
  successUrl: string;
  cancelUrl: string;
}

export interface ChangeSubscriptionPriceInput {
  subscriptionId: string;
  priceId: string;
}

export interface ReportSeatQuantityInput {
  subscriptionId: string;
  quantity: number;
}

export interface CreateBillingPortalSessionInput {
  customerId: string;
  returnUrl: string;
}

export interface StripeSubscriptionState {
  id: string;
  customerId: string;
  /** From subscription metadata — the `referenceId = organizationId` the checkout stamped. */
  organizationId: string;
  /** The Stripe price the subscription is on; the mirror resolves this to a plan template. */
  priceId: string;
  /** The subscription item's current seat quantity, so the seat reporter only writes on a change. */
  quantity: number;
  /** Stripe's own status vocabulary, verbatim (`active`, `trialing`, `canceled`, …). */
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}
