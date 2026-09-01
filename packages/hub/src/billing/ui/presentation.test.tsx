import assert from "node:assert/strict";
import { it } from "vitest";
import type { BillingOverviewView, PublicBillingPlan } from "../../server/runtime.js";
/**
 * Copy rules, not the product catalog. Where several plans are needed to pin generic behaviour
 * these use deliberately synthetic names — Hub sells one plan today, and a fixture that pretends
 * otherwise is how obsolete tiers end up on a screenshot.
 */

import {
  intervalLabel,
  offeredIntervals,
  planAction,
  planPrice,
  subscriptionSummary,
} from "./presentation.js";

const euros = (unitAmount: number) => ({ unitAmount, currency: "eur" });

function plan(
  slug: string,
  name: string,
  prices: Partial<PublicBillingPlan["prices"]>,
): PublicBillingPlan {
  return {
    slug,
    name,
    marketingFeatures: [],
    prices: { monthly: null, annual: null, ...prices },
  };
}

function subscription(
  overrides: Partial<BillingOverviewView["subscription"]>,
): BillingOverviewView["subscription"] {
  return {
    planSlug: null,
    planName: null,
    status: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    trialEnd: null,
    trialEligible: true,
    manageable: false,
    ...overrides,
  };
}

it("prices a paid plan as a figure the customer can read at a glance", () => {
  assert.deepEqual(planPrice(euros(1500), "monthly"), {
    amount: "€15",
    unit: "per user / month",
  });
  assert.deepEqual(planPrice(euros(15000), "annual"), {
    amount: "€150",
    unit: "per user / year",
  });
});

it("prices the free tier as a figure so every plan column shares a baseline", () => {
  assert.deepEqual(planPrice(euros(0), "monthly"), { amount: "€0", unit: "forever" });
});

it("says which interval is missing rather than showing a blank price", () => {
  assert.deepEqual(planPrice(null, "annual"), { amount: "—", unit: "No yearly price" });
});

it("keeps the plan name in the trial button's accessible name while the visible label stays short", () => {
  const action = planAction({
    planName: "Paseo Hub",
    price: euros(1500),
    isCurrent: false,
    trialEligible: true,
  });
  assert.deepEqual(action, {
    label: "Start free trial",
    name: "Start free trial with Paseo Hub",
    disabled: false,
  });
  assert.ok(
    action.name.includes(action.label),
    "the accessible name must contain the visible label",
  );
});

it("offers a former subscriber ordinary checkout instead of a second trial", () => {
  const action = planAction({
    planName: "Paseo Hub",
    price: euros(1500),
    isCurrent: false,
    trialEligible: false,
  });
  assert.deepEqual(action, {
    label: "Subscribe",
    name: "Subscribe to Paseo Hub",
    disabled: false,
  });
  assert.ok(
    action.name.includes(action.label),
    "the accessible name must contain the visible label",
  );
});

it("never offers a trial on a zero-priced plan, even when the organization is trial eligible", () => {
  assert.deepEqual(
    planAction({ planName: "Free", price: euros(0), isCurrent: false, trialEligible: true }),
    { label: "Subscribe", name: "Subscribe to Free", disabled: false },
  );
});

it("disables the plan the organization is already on and names it", () => {
  const action = planAction({
    planName: "Free",
    price: euros(0),
    isCurrent: true,
    trialEligible: true,
  });
  assert.deepEqual(action, { label: "Current plan", name: "Current plan: Free", disabled: true });
});

it("disables a plan the catalog does not price at the selected interval", () => {
  assert.deepEqual(
    planAction({ planName: "Paseo Hub", price: null, isCurrent: false, trialEligible: true }),
    { label: "Not available", name: "Not available: Paseo Hub", disabled: true },
  );
});

it("hides the interval switch for a catalog that only charges monthly", () => {
  const plans = [
    plan("free", "Free", { monthly: euros(0), annual: euros(0) }),
    plan("starter", "Starter", { monthly: euros(1500) }),
  ];
  assert.deepEqual(offeredIntervals(plans), ["monthly"]);
  assert.deepEqual(
    offeredIntervals([plan("starter", "Starter", { monthly: euros(1500), annual: euros(15000) })]),
    ["monthly", "annual"],
  );
  // A catalog with nothing priced still has to render at one interval.
  assert.deepEqual(offeredIntervals([]), ["monthly"]);
});

it("labels intervals the way the picker shows them", () => {
  assert.equal(intervalLabel("monthly"), "Monthly");
  assert.equal(intervalLabel("annual"), "Annual");
});

it("says nothing beyond the fact when there is no subscription to describe", () => {
  for (const trialEligible of [true, false]) {
    assert.deepEqual(subscriptionSummary(subscription({ trialEligible })), {
      planName: null,
      status: null,
      detail: null,
    });
  }
});

it("leads with the trial end date while a trial is running", () => {
  const summary = subscriptionSummary(
    subscription({
      planSlug: "hosted",
      planName: "Paseo Hub",
      status: "trialing",
      trialEnd: "2026-09-11T00:00:00.000Z",
      currentPeriodEnd: "2026-09-11T00:00:00.000Z",
      manageable: true,
    }),
  );
  assert.deepEqual(summary.status, { tone: "success", label: "Trialing" });
  assert.equal(summary.detail, "Trial ends September 11, 2026.");
});

it("leads with the cancellation date once a subscription is set to end", () => {
  const summary = subscriptionSummary(
    subscription({
      planSlug: "hosted",
      planName: "Paseo Hub",
      status: "active",
      cancelAtPeriodEnd: true,
      trialEnd: "2026-09-11T00:00:00.000Z",
      currentPeriodEnd: "2026-10-01T00:00:00.000Z",
      manageable: true,
    }),
  );
  assert.equal(summary.detail, "Cancels on October 1, 2026.");
});

it("warns on a payment problem and stays neutral on an unrecognised status", () => {
  assert.deepEqual(
    subscriptionSummary(subscription({ planName: "Paseo Hub", status: "past_due" })).status,
    { tone: "warning", label: "Past Due" },
  );
  assert.deepEqual(
    subscriptionSummary(subscription({ planName: "Paseo Hub", status: "paused" })).status,
    { tone: "neutral", label: "Paused" },
  );
});
