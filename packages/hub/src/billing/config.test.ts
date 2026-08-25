import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { readBillingConfig } from "./config.js";

describe("readBillingConfig", () => {
  it("returns undefined when STRIPE_SECRET_KEY is absent", () => {
    assert.equal(readBillingConfig({}), undefined);
  });

  it("returns undefined when STRIPE_SECRET_KEY is blank", () => {
    assert.equal(readBillingConfig({ STRIPE_SECRET_KEY: "   " }), undefined);
  });

  it("returns a config when both secrets are well-formed", () => {
    assert.deepEqual(
      readBillingConfig({
        STRIPE_SECRET_KEY: "sk_test_abc123",
        STRIPE_WEBHOOK_SECRET: "whsec_abc123",
      }),
      { stripeSecretKey: "sk_test_abc123", stripeWebhookSecret: "whsec_abc123" },
    );
  });

  it("throws when STRIPE_SECRET_KEY does not look like a Stripe secret key", () => {
    assert.throws(
      () =>
        readBillingConfig({
          STRIPE_SECRET_KEY: "not-a-stripe-key",
          STRIPE_WEBHOOK_SECRET: "whsec_abc123",
        }),
      /STRIPE_SECRET_KEY is invalid/,
    );
  });

  it("throws when STRIPE_WEBHOOK_SECRET is missing", () => {
    assert.throws(
      () => readBillingConfig({ STRIPE_SECRET_KEY: "sk_test_abc123" }),
      /STRIPE_WEBHOOK_SECRET is required/,
    );
  });

  it("throws when STRIPE_WEBHOOK_SECRET does not look like a Stripe webhook secret", () => {
    assert.throws(
      () =>
        readBillingConfig({
          STRIPE_SECRET_KEY: "sk_test_abc123",
          STRIPE_WEBHOOK_SECRET: "not-a-webhook-secret",
        }),
      /STRIPE_WEBHOOK_SECRET is invalid/,
    );
  });
});
