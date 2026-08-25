import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { hashTemplate } from "../entitlements/catalog.js";
import { parsePlanMetadata } from "./plan-template.js";

const VALID_METADATA = {
  paseo_plan: "true",
  paseo_plan_slug: "solo",
  ent_seats_max: "5",
  ent_can_invite: "true",
  ent_executions_monthly_limit: "2000",
};

describe("parsePlanMetadata", () => {
  it("parses flat scalar metadata into a slug and entitlement template", () => {
    const result = parsePlanMetadata(VALID_METADATA);
    assert.equal(result.success, true);
    assert.deepEqual(result.success ? result.data : undefined, {
      slug: "solo",
      template: {
        seats: { max: 5 },
        canInviteMembers: true,
        meters: { "executions.monthly": { limit: 2000 } },
      },
    });
  });

  it('maps "unlimited" to null, matching the catalog\'s null-means-unlimited convention', () => {
    const result = parsePlanMetadata({
      ...VALID_METADATA,
      ent_seats_max: "unlimited",
      ent_executions_monthly_limit: "unlimited",
    });
    assert.equal(result.success, true);
    assert.equal(result.success ? result.data.template.seats.max : undefined, null);
    assert.equal(
      result.success ? result.data.template.meters["executions.monthly"].limit : undefined,
      null,
    );
  });

  it("rejects a non-numeric, non-unlimited limit instead of storing a garbage template", () => {
    const result = parsePlanMetadata({ ...VALID_METADATA, ent_seats_max: "lots" });
    assert.equal(result.success, false);
  });

  it("rejects a limit of zero or negative", () => {
    const result = parsePlanMetadata({ ...VALID_METADATA, ent_seats_max: "0" });
    assert.equal(result.success, false);
  });

  it('rejects a boolean flag that is not exactly "true" or "false"', () => {
    const result = parsePlanMetadata({ ...VALID_METADATA, ent_can_invite: "yes" });
    assert.equal(result.success, false);
  });

  it("rejects a blank plan slug", () => {
    const result = parsePlanMetadata({ ...VALID_METADATA, paseo_plan_slug: "" });
    assert.equal(result.success, false);
  });

  it("rejects metadata missing a required key entirely", () => {
    const { ent_seats_max: _omitted, ...withoutSeats } = VALID_METADATA;
    const result = parsePlanMetadata(withoutSeats);
    assert.equal(result.success, false);
  });

  it("produces a template whose hash is reused from entitlements/catalog.ts", () => {
    const result = parsePlanMetadata(VALID_METADATA);
    assert.equal(result.success, true);
    const hash = result.success ? hashTemplate(result.data.template) : undefined;
    assert.equal(typeof hash, "string");
    assert.equal(hash?.length, 64);
  });
});
