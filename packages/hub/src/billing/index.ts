import StripeSDK from "stripe";
import type {
  BillingPlanRecord,
  Database,
  StampOrganizationEntitlementsInput,
} from "../db/types.js";
import {
  entitlementsSchema,
  hashTemplate,
  type Entitlements,
  type EntitlementTemplate,
} from "../entitlements/catalog.js";
import type { ProvisioningEntitlement } from "../organizations/provisioning.js";
import { reportFailure } from "../failures/index.js";
import { logger } from "../logger.js";
import { syncBillingCatalog } from "./catalog-sync.js";
import type { BillingConfig } from "./config.js";
import type { StripeCatalogSource } from "./stripe-catalog-source.js";
import type { BillingPlanPriceInterval } from "../db/types.js";
import type { StripeBillingClient, StripeSubscriptionState } from "./stripe-billing-client.js";
import { selectActivePlanPrice } from "./plan-prices.js";
import { publicBillingPlans, type PublicBillingPlan } from "./public-catalog.js";

/** The organization's live seat count (members + pending invitations). Injected by the
 * composition root — the count reads Better Auth tables the `Database` interface does not model,
 * so billing receives it as a narrow function rather than reaching for a pool. */
export type SeatUsageReader = (organizationId: string) => Promise<number>;

export { readBillingConfig } from "./config.js";
export type { BillingConfig } from "./config.js";
export { createStripeCatalogSource, createStripeBillingClient } from "./stripe-client.js";
export type {
  StripeCatalogSource,
  StripeCatalogProduct,
  StripeCatalogPrice,
} from "./stripe-catalog-source.js";
export type { StripeBillingClient, StripeSubscriptionState } from "./stripe-billing-client.js";
export { selectActivePlanPrice, AmbiguousPlanPriceError } from "./plan-prices.js";
export type { PublicBillingPlan, PublicBillingPlanPrice } from "./public-catalog.js";

/**
 * The four Stripe events that mean "the plan catalog may have changed" — see the plan's
 * "Mirror, do not fetch" section. Every other event type is acknowledged and ignored.
 */
const CATALOG_SYNC_EVENT_TYPES = new Set([
  "product.created",
  "product.updated",
  "price.created",
  "price.updated",
]);

/**
 * Subscription lifecycle events. Each carries only a reference; the handler re-reads the
 * authoritative subscription state and stamps, so retries and out-of-order delivery converge.
 */
const SUBSCRIPTION_SYNC_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/** Statuses whose plan is stamped onto the organization. A dunning status (`past_due`, `unpaid`,
 * `incomplete`) leaves the last stamp untouched — the organization is grandfathered while payment
 * is retried, not dropped mid-cycle. */
const STAMPABLE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

/** Terminal statuses: the subscription is over. Reconciliation stamps Free so a customer who
 * cancels through the portal cannot keep paid entitlements. */
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired", "unpaid"]);

/** Whether a subscription webhook could be reconciled now, or Stripe should retry it later. */
type ReconcileOutcome = "reconciled" | "retry";

/** The entitlement stamp reconciliation commits alongside the subscription mirror. */
type SubscriptionStamp = Omit<StampOrganizationEntitlementsInput, "organizationId">;

/** The per-organization advisory-lock key that serializes subscription reconciliation across
 * processes, so an older webhook resuming after a newer one cannot revert the stamp. */
function billingLockKey(organizationId: string): string {
  return `billing:subscription:${organizationId}`;
}

/**
 * The internal entitlement record a hosted organization is stamped with before it pays and again
 * after it cancels. Identified by its `paseo_plan_slug` metadata, mirrored as `billing_plans.slug`
 * — so which product carries the floor is set in the Stripe dashboard, not hardcoded here (the
 * plan's "Stripe is the source of truth" rule).
 *
 * It is not an offer. Nothing customer-facing may present it as the organization's plan or as
 * something to buy: `publicCatalog` withholds it from the catalog, and `subscriptionSnapshot`
 * reports an organization stamped with it as having no plan. Enforcing both here is what keeps
 * consumers from having to know this slug exists.
 */
const FREE_PLAN_SLUG = "free";

/**
 * The conservative floor used only when billing is configured but the mirror has no active Free
 * plan — a first boot before the sync lands, or a Stripe account with no Free product. Not a
 * mirror of any Stripe plan: it fails closed (one seat, no invites, a small execution cap) so a
 * new organization can never get everything for free, while `provisioningEntitlement` logs loudly
 * so an operator notices and fixes the catalog. A misconfigured Stripe is recoverable — every
 * organization stamped from this floor re-stamps to the real Free plan the moment it subscribes.
 */
const FREE_TIER_FALLBACK: EntitlementTemplate = {
  seats: { max: 1 },
  canInviteMembers: false,
  meters: { "executions.monthly": { limit: 0 } },
};

export interface ComposeBillingOptions {
  config: BillingConfig;
  database: Database;
  /** Production wires the real Stripe SDK; the E2E harness wires a fixture. See stripe-catalog-source.ts. */
  catalogSource: StripeCatalogSource;
  /** Production wires the real Stripe SDK; the E2E harness wires a fixture. See stripe-billing-client.ts. */
  billingClient: StripeBillingClient;
  /** Reads an organization's live seat count for post-paid quantity reporting. */
  seatUsage: SeatUsageReader;
}

export interface CreateCheckoutInput {
  organizationId: string;
  planSlug: string;
  interval: BillingPlanPriceInterval;
  successUrl: string;
  cancelUrl: string;
  accountEmail: string | null;
  accountName: string | null;
}

export interface CreatePortalInput {
  organizationId: string;
  returnUrl: string;
}

/** The organization's current subscription, resolved against the plan mirror for display. */
export interface CurrentSubscriptionView {
  planSlug: string | null;
  planName: string | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  trialEligible: boolean;
  /** True when a subscription exists, so "Manage billing" (the Stripe portal) can be opened. */
  manageable: boolean;
}

/** Thrown when a checkout is requested for a plan/interval that is not in the mirror. */
export class BillingRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingRequestError";
  }
}

/**
 * HOSTED. Stripe, plans, subscriptions, checkout, portal, webhooks. `src/billing/` is
 * registered at the composition root only when `readBillingConfig()` returns a config, and
 * nothing outside `src/billing/` or the composition root may import this module (enforced by
 * oxlint).
 *
 * The single coupling to core runs the other way: `billing` writes the organization's entitlement
 * stamp — through `database.reconcileOrganizationSubscription`, which commits the stamp and the
 * subscription mirror in one transaction so a webhook can never leave them disagreeing.
 * `src/entitlements/` never imports this module.
 */
export class BillingRuntime {
  /** Signature verification only — a fixture's plausible-but-fake secret works identically. */
  private readonly stripe: StripeSDK;
  private readonly subscriptionCache = new Map<
    string,
    {
      value: readonly StripeSubscriptionState[];
      expiresAt: number;
      pending?: Promise<readonly StripeSubscriptionState[]>;
    }
  >();

  constructor(
    private readonly config: BillingConfig,
    private readonly database: Database,
    private readonly catalogSource: StripeCatalogSource,
    private readonly billingClient: StripeBillingClient,
    private readonly seatUsage: SeatUsageReader,
  ) {
    this.stripe = new StripeSDK(config.stripeSecretKey);
  }

  async syncCatalog(): Promise<void> {
    await syncBillingCatalog(this.catalogSource, this.database);
  }

  /**
   * The plans a customer may buy, derived from the catalog mirror. Everything that renders an
   * offer — the public plans endpoint, the billing overview, the picker — reads this and nothing
   * else, so "what Hub sells" is decided once, here.
   */
  async publicCatalog(): Promise<PublicBillingPlan[]> {
    return publicBillingPlans(await this.database.listBillingPlans(), FREE_PLAN_SLUG);
  }

  /**
   * What a hosted organization is stamped with at provisioning: the Free plan's template resolved
   * from the catalog mirror. When no active Free plan is mirrored yet — a first boot before the
   * sync, or a misconfigured Stripe account — it falls back to a conservative floor and logs
   * loudly rather than failing open to unlimited or bricking organization creation. The
   * composition root wires this into the auth server's provisioning resolver; self-hosted
   * (no billing) never reaches here and keeps stamping unlimited.
   */
  async provisioningEntitlement(): Promise<ProvisioningEntitlement> {
    return this.freeEntitlement();
  }

  /**
   * The Free plan's template from the catalog mirror — what both provisioning and a terminal
   * cancellation stamp. When no active Free plan is mirrored yet (a first boot before the sync,
   * or a Stripe account missing the product) it falls back to the conservative floor and logs
   * loudly rather than failing open to unlimited.
   */
  private async freeEntitlement(): Promise<{ planId: string | null; granted: Entitlements }> {
    const plans = await this.database.listBillingPlans();
    const free = plans.find((plan) => plan.slug === FREE_PLAN_SLUG && plan.active);
    if (free !== undefined) {
      return { planId: free.id, granted: entitlementsSchema.parse(free.template) };
    }
    reportFailure(
      Object.assign(new Error("Billing catalog has no active free plan"), {
        code: "billing_free_plan_missing",
      }),
      { operation: "billing.entitlement.free.resolve", component: "billing", provider: "stripe" },
    );
    return { planId: null, granted: entitlementsSchema.parse(FREE_TIER_FALLBACK) };
  }

  /**
   * Put the organization onto `planSlug`/`interval`. The first time, this is a Checkout Session
   * (Stripe collects payment and creates the subscription). Every subsequent change updates the
   * organization's existing subscription item in place — Stripe models a plan change as an update
   * to the one subscription, so a change never opens a second checkout or a second subscription.
   * Reference authorization (only a manager may act for the organization) is enforced upstream at
   * the composition root before this is reached.
   */
  async createCheckout(input: CreateCheckoutInput): Promise<{ url: string }> {
    const price = await this.resolvePlanPrice(input.planSlug, input.interval);
    const customerId = await this.resolveCustomer(input);
    const subscriptions = await this.customerSubscriptions(customerId);
    const existing = subscriptions.find(
      (subscription) => !TERMINAL_SUBSCRIPTION_STATUSES.has(subscription.status),
    );
    if (existing !== undefined) {
      await this.billingClient.changeSubscriptionPrice({
        subscriptionId: existing.id,
        priceId: price.priceId,
      });
      this.invalidateSubscriptions(customerId);
      // The change is immediate; Stripe fires a subscription webhook that re-stamps entitlements.
      // Return the caller straight back to the billing page rather than through checkout.
      return { url: input.successUrl };
    }
    const checkout = await this.billingClient.createCheckoutSession({
      organizationId: input.organizationId,
      customerId,
      priceId: price.priceId,
      // Start the subscription billed for the organization's actual seats, not a hardcoded one.
      quantity: await this.seatUsage(input.organizationId),
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      trial: subscriptions.length === 0,
    });
    this.invalidateSubscriptions(customerId);
    return checkout;
  }

  /**
   * Re-report the organization's seat count to Stripe after a membership change. Driven post-commit
   * by the auth server (member/invitation writes) and, as a durable backstop, by every subscription
   * webhook reconciliation. It only writes when the count actually moved, so the resulting
   * subscription webhook echo carries no delta and cannot ping-pong. No subscription means nothing
   * to bill — a self-hosted or provisioned-Free organization returns immediately.
   */
  async reportSeatUsage(organizationId: string): Promise<void> {
    const customer = await this.database.getOrganizationBillingCustomer(organizationId);
    if (customer === undefined) return;
    const subscription = (await this.customerSubscriptions(customer.stripeCustomerId)).find(
      (candidate) => !TERMINAL_SUBSCRIPTION_STATUSES.has(candidate.status),
    );
    if (subscription === undefined) return;
    await this.database.withAdvisoryLock(billingLockKey(organizationId), async () => {
      const state = await this.billingClient.getSubscription(subscription.id);
      if (state !== undefined) await this.settleSeatQuantity(state);
    });
  }

  /** Report the live seat count when — and only when — it differs from what the subscription is
   * currently billed for. Both the membership-driven path and reconciliation share this, so the
   * change-only rule (which stops the webhook echo looping) lives in exactly one place. */
  private async settleSeatQuantity(state: StripeSubscriptionState): Promise<void> {
    if (!STAMPABLE_SUBSCRIPTION_STATUSES.has(state.status)) return;
    const quantity = await this.seatUsage(state.organizationId);
    if (quantity === state.quantity) return;
    await this.billingClient.reportSeatQuantity({ subscriptionId: state.id, quantity });
  }

  /** Open the Stripe billing portal for the organization's customer, or undefined when it has
   * no subscription yet (nothing for the portal to manage). */
  async createPortal(input: CreatePortalInput): Promise<{ url: string } | undefined> {
    const customer = await this.database.getOrganizationBillingCustomer(input.organizationId);
    if (customer === undefined) return undefined;
    return this.billingClient.createBillingPortalSession({
      customerId: customer.stripeCustomerId,
      returnUrl: input.returnUrl,
    });
  }

  /**
   * The organization's current plan and subscription status, for the billing section. The plan
   * shown is the plan enforced: it is derived from what the organization was last *stamped* with
   * (its entitlements provenance), not from the Stripe subscription, so a trialing organization
   * reads the plan it is trialing. The subscription mirror only decides whether there is a live
   * subscription to manage.
   *
   * A stamp of the internal free record is not a plan. An organization that has not subscribed —
   * or has cancelled back down to it — reports no plan at all, which is what makes the billing
   * page a paywall rather than an advert for a tier nobody sells.
   */
  async subscriptionSnapshot(organizationId: string): Promise<CurrentSubscriptionView> {
    const [customer, plans, entitlements] = await Promise.all([
      this.database.getOrganizationBillingCustomer(organizationId),
      this.database.listBillingPlans(),
      this.database.getOrganizationEntitlements(organizationId),
    ]);
    const stamped = plans.find((plan) => plan.id === entitlements?.planId);
    const purchased = stamped?.slug === FREE_PLAN_SLUG ? undefined : stamped;
    const subscriptions =
      customer === undefined ? [] : await this.customerSubscriptions(customer.stripeCustomerId);
    const subscription = subscriptions.find(
      (candidate) => !TERMINAL_SUBSCRIPTION_STATUSES.has(candidate.status),
    );
    const live = subscription !== undefined;
    return {
      planSlug: purchased?.slug ?? null,
      planName: purchased?.name ?? null,
      status: live ? subscription.status : null,
      cancelAtPeriodEnd: live ? subscription.cancelAtPeriodEnd : false,
      currentPeriodEnd: live ? (subscription.currentPeriodEnd?.toISOString() ?? null) : null,
      trialEnd: live ? (subscription.trialEnd?.toISOString() ?? null) : null,
      trialEligible: subscriptions.length === 0,
      manageable: live,
    };
  }

  async handleWebhook(request: Request): Promise<Response> {
    const payload = await request.text();
    const signatureHeader = request.headers.get("stripe-signature");
    if (signatureHeader === null) {
      reportFailure(
        Object.assign(new Error("Stripe signature header missing"), {
          code: "signature_header_missing",
        }),
        {
          operation: "billing.webhook.verify",
          component: "billing",
          provider: "stripe",
          status: 400,
        },
        { status: 400, kind: "authentication", scrubValues: [this.config.stripeWebhookSecret] },
      );
      return new Response("missing signature", { status: 400 });
    }
    let event: StripeSDK.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signatureHeader,
        this.config.stripeWebhookSecret,
      );
    } catch (error) {
      reportFailure(
        error,
        {
          operation: "billing.webhook.verify",
          component: "billing",
          provider: "stripe",
          status: 400,
        },
        {
          status: 400,
          kind: "authentication",
          scrubValues: [this.config.stripeWebhookSecret, signatureHeader],
        },
      );
      return new Response("invalid signature", { status: 400 });
    }
    try {
      if (CATALOG_SYNC_EVENT_TYPES.has(event.type)) {
        await this.syncCatalog();
      }
      if (SUBSCRIPTION_SYNC_EVENT_TYPES.has(event.type)) {
        const outcome = await this.reconcileSubscriptionEvent(event);
        if (outcome === "retry") {
          reportFailure(
            Object.assign(new Error("Stripe subscription is not reconcilable yet"), {
              code: "upstreamUnavailable",
            }),
            {
              operation: "billing.webhook.subscription.reconcile",
              component: "billing",
              provider: "stripe",
              status: 503,
            },
            { status: 503, diagnostic: { eventType: event.type } },
          );
          return new Response("subscription not reconcilable yet", { status: 503 });
        }
      }
    } catch (error) {
      // Anything transient (a Stripe read, the catalog sync, the atomic write) returns non-2xx so
      // Stripe redelivers, rather than acknowledging a state we never reconciled.
      reportFailure(
        error,
        {
          operation: "billing.webhook.reconcile",
          component: "billing",
          provider: "stripe",
          status: 503,
        },
        {
          status: 503,
          scrubValues: [this.config.stripeWebhookSecret, signatureHeader],
          diagnostic: { eventType: event.type },
        },
      );
      return new Response("reconciliation failed", { status: 503 });
    }
    logger.info(
      { provider: "stripe", eventId: event.id, eventType: event.type },
      "billing webhook processed",
    );
    return Response.json({ received: true });
  }

  /**
   * Converge the organization's entitlements and subscription mirror onto the subscription's live
   * state. The whole critical section runs under a per-organization advisory lock, and the state
   * is re-read *inside* that lock — so when an older delivery resumes after a newer one, it still
   * reads current state and stamps the same result instead of reverting. The mirror upsert and the
   * entitlement stamp commit in one transaction. Returns "retry" when the state cannot be
   * reconciled yet (a price not in the mirror even after a resync, or an unreadable subscription),
   * which the caller turns into a 503 so Stripe redelivers.
   */
  private async reconcileSubscriptionEvent(event: StripeSDK.Event): Promise<ReconcileOutcome> {
    const subscriptionId = subscriptionReferenceFromEvent(event);
    // A checkout session that completed without a subscription carries nothing to reconcile.
    if (subscriptionId === undefined) return "reconciled";
    const reference = await this.billingClient.getSubscription(subscriptionId);
    if (reference === undefined) return "retry";
    return this.database.withAdvisoryLock(billingLockKey(reference.organizationId), () =>
      this.reconcileSubscriptionUnderLock(subscriptionId),
    );
  }

  private async reconcileSubscriptionUnderLock(subscriptionId: string): Promise<ReconcileOutcome> {
    const state = await this.billingClient.getSubscription(subscriptionId);
    if (state === undefined) return "retry";
    const terminal = TERMINAL_SUBSCRIPTION_STATUSES.has(state.status);
    let plan = await this.resolvePlanByPrice(state.priceId);
    if (plan === undefined && !terminal) {
      // A subscription webhook can beat its own price/product webhook. Resync once, then
      // re-resolve; if the price is still unmirrored, retry rather than acknowledge an unstamped
      // subscription that nothing would ever revisit.
      await this.syncCatalog();
      plan = await this.resolvePlanByPrice(state.priceId);
      if (plan === undefined) return "retry";
    }
    const stamp = await this.resolveStamp(state.status, terminal, plan);
    this.invalidateSubscriptions(state.customerId);
    await this.database.reconcileOrganizationBilling({
      organizationId: state.organizationId,
      stripeCustomerId: state.customerId,
      ...(stamp === undefined ? {} : { stamp }),
    });
    // Durable backstop for the membership-driven reporter: any subscription webhook re-reports the
    // seat count if it drifted. Runs under the same lock, and only writes on a change.
    await this.settleSeatQuantity(state);
    return "reconciled";
  }

  /** Which template the reconciled state should stamp, or undefined to grandfather the last one. */
  private async resolveStamp(
    status: string,
    terminal: boolean,
    plan: BillingPlanRecord | undefined,
  ): Promise<SubscriptionStamp | undefined> {
    if (terminal) {
      const free = await this.freeEntitlement();
      return planStamp(free.granted, free.planId);
    }
    if (!STAMPABLE_SUBSCRIPTION_STATUSES.has(status) || plan === undefined) return undefined;
    return planStamp(entitlementsSchema.parse(plan.template), plan.id);
  }

  private async resolveCustomer(input: CreateCheckoutInput): Promise<string> {
    const existing = await this.database.getOrganizationBillingCustomer(input.organizationId);
    if (existing !== undefined) return existing.stripeCustomerId;
    return this.billingClient.ensureCustomer({
      organizationId: input.organizationId,
      email: input.accountEmail,
      name: input.accountName,
    });
  }

  private customerSubscriptions(customerId: string): Promise<readonly StripeSubscriptionState[]> {
    const now = Date.now();
    const cached = this.subscriptionCache.get(customerId);
    if (cached?.value !== undefined && cached.expiresAt > now) return Promise.resolve(cached.value);
    if (cached?.pending !== undefined) return cached.pending;
    const pending = this.billingClient
      .listCustomerSubscriptions(customerId)
      .then((value) => {
        this.subscriptionCache.set(customerId, { value, expiresAt: Date.now() + 5_000 });
        return value;
      })
      .catch((error: unknown) => {
        this.subscriptionCache.delete(customerId);
        throw error;
      });
    this.subscriptionCache.set(customerId, { value: cached?.value ?? [], expiresAt: 0, pending });
    return pending;
  }

  private invalidateSubscriptions(customerId: string): void {
    this.subscriptionCache.delete(customerId);
  }

  private async resolvePlanPrice(
    slug: string,
    interval: BillingPlanPriceInterval,
  ): Promise<{ priceId: string; planId: string }> {
    const plans = await this.database.listBillingPlans();
    const plan = plans.find((candidate) => candidate.slug === slug && candidate.active);
    if (plan === undefined) throw new BillingRequestError(`unknown plan: ${slug}`);
    // Exact `{slug}_{interval}` lookup-key identity — a second active monthly price is an ambiguity
    // (`AmbiguousPlanPriceError`), never an arbitrary charge.
    const price = selectActivePlanPrice(plan.prices, slug, interval);
    if (price === undefined) {
      throw new BillingRequestError(`plan ${slug} has no active ${interval} price`);
    }
    return { priceId: price.id, planId: plan.id };
  }

  private async resolvePlanByPrice(priceId: string): Promise<BillingPlanRecord | undefined> {
    const plans = await this.database.listBillingPlans();
    return plans.find((plan) => plan.prices.some((price) => price.id === priceId));
  }
}

/** The `plan_stamp` reconciliation writes onto an organization; `plan_version` is the template
 * hash so a replay with an unchanged template is a no-op. */
function planStamp(granted: Entitlements, planId: string | null): SubscriptionStamp {
  return {
    granted,
    planId,
    planVersion: hashTemplate(granted),
    source: "plan_stamp",
    actor: null,
    reason: null,
  };
}

/**
 * The subscription id a lifecycle event references. A subscription event carries it directly;
 * `checkout.session.completed` carries it on the session's `subscription` field.
 */
function subscriptionReferenceFromEvent(event: StripeSDK.Event): string | undefined {
  if (event.type === "checkout.session.completed") {
    const subscription = event.data.object.subscription;
    if (subscription === null) return undefined;
    return typeof subscription === "string" ? subscription : subscription.id;
  }
  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    return event.data.object.id;
  }
  return undefined;
}

export function composeBilling(options: ComposeBillingOptions): BillingRuntime {
  return new BillingRuntime(
    options.config,
    options.database,
    options.catalogSource,
    options.billingClient,
    options.seatUsage,
  );
}
