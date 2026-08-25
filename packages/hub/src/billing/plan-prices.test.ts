import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { BillingPlanPriceInterval, BillingPlanPriceRecord } from "../db/types.js";
import {
  AmbiguousPlanPriceError,
  expectedLookupKey,
  selectActivePlanPrice,
} from "./plan-prices.js";

function price(overrides: Partial<BillingPlanPriceRecord>): BillingPlanPriceRecord {
  return {
    id: "price_1",
    planId: "prod_solo",
    lookupKey: "solo_monthly",
    interval: "monthly",
    unitAmount: 2900,
    currency: "usd",
    active: true,
    ...overrides,
  };
}

describe("selectActivePlanPrice", () => {
  it("keys the lookup by slug and interval", () => {
    assert.equal(expectedLookupKey("solo", "monthly"), "solo_monthly");
    assert.equal(expectedLookupKey("team", "annual"), "team_annual");
  });

  it("selects the active price whose lookup key matches exactly", () => {
    const selected = selectActivePlanPrice([price({ id: "keep" })], "solo", "monthly");
    assert.equal(selected?.id, "keep");
  });

  it("ignores a price whose interval matches but whose lookup key does not", () => {
    // A monthly price mislabelled with the wrong lookup key must not be charged by "first monthly".
    const prices = [price({ id: "wrong_key", lookupKey: "legacy_monthly" })];
    assert.equal(selectActivePlanPrice(prices, "solo", "monthly"), undefined);
  });

  it("ignores an inactive price that carries the right key", () => {
    const prices = [price({ id: "archived", active: false })];
    assert.equal(selectActivePlanPrice(prices, "solo", "monthly"), undefined);
  });

  it("rejects ambiguity instead of picking one of two active prices for the key", () => {
    const prices = [price({ id: "a" }), price({ id: "b" })];
    assert.throws(() => selectActivePlanPrice(prices, "solo", "monthly"), AmbiguousPlanPriceError);
  });

  it("returns undefined when no price carries the key", () => {
    const interval: BillingPlanPriceInterval = "annual";
    assert.equal(selectActivePlanPrice([price({})], "solo", interval), undefined);
  });
});
