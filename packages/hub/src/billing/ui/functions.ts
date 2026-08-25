import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { respondOk, type Result } from "../../contract/respond.js";
import { respondWithFailure } from "../../failures/index.js";
import { tenantRouteNotFoundMessage } from "../../projects/access.js";
import {
  handleBillingCheckout,
  handleBillingOverview,
  handleBillingPortal,
  type BillingOverviewView,
} from "../../server/runtime.js";

/**
 * The dashboard billing surface. It lives under `src/billing/ui/`, inside the feature it belongs
 * to; the billing dashboard route is exempted from the import boundary (like a composition root)
 * so it can mount this. Every function is a thin wrapper over the composition root, which owns
 * Stripe and the `authorizeReference` capability check. The "is billing configured" probe is a
 * core capability check, not billing logic, so it lives in `src/server/capabilities.ts`.
 */
const organizationScopeSchema = z
  .object({ organizationSlug: z.string().trim().min(1).max(100) })
  .strict();

const checkoutSchema = z
  .object({
    organizationSlug: z.string().trim().min(1).max(100),
    planSlug: z.string().trim().min(1).max(100),
    interval: z.enum(["monthly", "annual"]),
  })
  .strict();

export const billingOverview = createServerFn({ method: "GET" })
  .validator(organizationScopeSchema)
  .handler(async ({ data }): Promise<Result<BillingOverviewView>> => {
    try {
      return respondOk(await handleBillingOverview(getRequest(), data.organizationSlug));
    } catch (error) {
      const message = billingOverviewErrorMessage(error);
      return respondWithFailure(error, billingContext("billing.overview", data.organizationSlug), {
        fallback: message,
        notFound: message,
        forbidden: message,
      });
    }
  });

export const billingCheckout = createServerFn({ method: "POST" })
  .validator(checkoutSchema)
  .handler(async ({ data }): Promise<Result<{ url: string }>> => {
    try {
      return respondOk(await handleBillingCheckout(getRequest(), data));
    } catch (error) {
      const message = billingActionErrorMessage(error);
      return respondWithFailure(
        error,
        { ...billingContext("billing.checkout", data.organizationSlug), provider: "stripe" },
        billingMessages(message),
      );
    }
  });

export const billingPortal = createServerFn({ method: "POST" })
  .validator(organizationScopeSchema)
  .handler(async ({ data }): Promise<Result<{ url: string | null }>> => {
    try {
      return respondOk(await handleBillingPortal(getRequest(), data.organizationSlug));
    } catch (error) {
      const message = billingActionErrorMessage(error);
      return respondWithFailure(
        error,
        { ...billingContext("billing.portal", data.organizationSlug), provider: "stripe" },
        billingMessages(message),
      );
    }
  });

export function billingOverviewErrorMessage(error: unknown): string {
  return tenantRouteNotFoundMessage(error) ?? "We couldn't load billing for this organization.";
}

/**
 * `handleBillingCheckout`/`handleBillingPortal` live in the composition root, a different
 * bundler chunk than this handler, so a thrown `BillingForbiddenError` can carry a different
 * class identity here — `instanceof` is unreliable across that boundary. Map by the stable
 * `name` instead, the way the operator path does.
 */
export function billingActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "BillingForbiddenError") {
    return "Only an organization owner or admin can change billing.";
  }
  return "Hub couldn't complete the billing action. Check Stripe availability and reload the current billing state before submitting again.";
}

function billingContext(operation: string, organizationSlug: string) {
  return { operation, component: "billing", organizationSlug } as const;
}

function billingMessages(fallback: string) {
  return {
    fallback,
    forbidden: fallback,
    rateLimited:
      "Stripe rate limited Hub. Wait a few minutes before submitting the billing action again.",
    network:
      "Hub couldn't connect to Stripe. Check this server's network, DNS, and TLS access to api.stripe.com before submitting again.",
    timeout:
      "Stripe did not respond before the billing request timed out. Check Stripe status before submitting again.",
    upstreamUnavailable:
      "Stripe is unavailable right now. Check Stripe status before submitting the billing action again.",
  };
}
