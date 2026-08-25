import { describe, expect, it } from "vitest";
import { EntitlementDenied } from "./catalog.js";
import {
  decodeEntitlementDenialFailureReason,
  encodeEntitlementDenialFailureReason,
  entitlementDenialSummary,
  parseEntitlementDenial,
} from "./denial.js";

describe("entitlement denial failure-reason codec", () => {
  it("round-trips a metered denial through the run failure_reason column", () => {
    const denial = new EntitlementDenied("executions.monthly", "meter", 1, 1).payload();
    const encoded = encodeEntitlementDenialFailureReason(denial);
    expect(decodeEntitlementDenialFailureReason(encoded)).toEqual(denial);
  });

  it("round-trips a flag denial", () => {
    const denial = new EntitlementDenied("canInviteMembers", "flag", null, null).payload();
    const encoded = encodeEntitlementDenialFailureReason(denial);
    expect(decodeEntitlementDenialFailureReason(encoded)).toEqual(denial);
  });

  it("returns undefined for reasons that are not denials", () => {
    expect(decodeEntitlementDenialFailureReason(null)).toBeUndefined();
    expect(decodeEntitlementDenialFailureReason("whole_run_timeout")).toBeUndefined();
    expect(decodeEntitlementDenialFailureReason("step_idle_timeout")).toBeUndefined();
    // Well-formed JSON that is not a denial payload must not be mistaken for one.
    expect(decodeEntitlementDenialFailureReason('{"error":"boom"}')).toBeUndefined();
  });

  it("summarizes a decoded denial without pattern-matching a human string", () => {
    const meter = parseEntitlementDenial({
      error: "entitlement_denied",
      entitlement: "executions.monthly",
      kind: "meter",
      limit: 1,
      current: 1,
    });
    expect(meter).toBeDefined();
    expect(entitlementDenialSummary(meter!)).toContain("executions.monthly");
    expect(entitlementDenialSummary(meter!)).toContain("1 of 1");
  });
});
