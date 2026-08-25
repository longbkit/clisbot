import { createServerFn } from "@tanstack/react-start";
import { isBillingConfigured } from "./runtime.js";

/**
 * Whether the hosted billing feature is mounted on this instance. A capability probe, not billing
 * logic — it never touches Stripe or `src/billing/` — so it lives in core and the dashboard shell
 * can gate the Billing nav entry on it without crossing the billing import boundary. The billing
 * dashboard route reuses it as its loader guard.
 */
export const billingConfigured = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ configured: boolean }> => ({ configured: await isBillingConfigured() }),
);
