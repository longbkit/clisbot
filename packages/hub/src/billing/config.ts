import { z } from "zod";

export interface BillingConfig {
  stripeSecretKey: string;
  /** Verifies `Stripe-Signature` on `/api/billing/webhook`. Required whenever billing is on. */
  stripeWebhookSecret: string;
}

const stripeSecretKeySchema = z
  .string()
  .trim()
  .min(1, "STRIPE_SECRET_KEY must not be blank")
  .refine((value) => value.startsWith("sk_"), 'STRIPE_SECRET_KEY must start with "sk_"');

const stripeWebhookSecretSchema = z
  .string()
  .trim()
  .min(1, "STRIPE_WEBHOOK_SECRET must not be blank")
  .refine((value) => value.startsWith("whsec_"), 'STRIPE_WEBHOOK_SECRET must start with "whsec_"');

/**
 * Undefined means self-hosted: no billing routes, no navigation entry, no UI, nothing stamps.
 * `src/billing/` is registered at the composition root only when this returns a config.
 */
export function readBillingConfig(
  environment: Record<string, string | undefined> = process.env,
): BillingConfig | undefined {
  const raw = environment["STRIPE_SECRET_KEY"];
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const result = stripeSecretKeySchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`STRIPE_SECRET_KEY is invalid: ${result.error.issues[0]?.message}`);
  }
  const rawWebhookSecret = environment["STRIPE_WEBHOOK_SECRET"];
  if (rawWebhookSecret === undefined || rawWebhookSecret.trim().length === 0) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set");
  }
  const webhookResult = stripeWebhookSecretSchema.safeParse(rawWebhookSecret);
  if (!webhookResult.success) {
    throw new Error(`STRIPE_WEBHOOK_SECRET is invalid: ${webhookResult.error.issues[0]?.message}`);
  }
  return { stripeSecretKey: result.data, stripeWebhookSecret: webhookResult.data };
}
