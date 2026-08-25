import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { providerEventDropReasonSummary } from "./drop-reason.js";

describe("provider event drop reasons", () => {
  it("maps stable codes to fixed provider-neutral summaries", () => {
    assert.equal(
      providerEventDropReasonSummary("trigger_filters_rejected"),
      "The event did not pass the configured trigger filters.",
    );
    assert.equal(providerEventDropReasonSummary("PRIVATE-EVENT-BODY"), null);
  });
});
