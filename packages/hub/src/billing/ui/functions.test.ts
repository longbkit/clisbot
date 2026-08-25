import assert from "node:assert/strict";
import { it } from "vitest";
import { TenantRouteNotFoundError } from "../../projects/access.js";
import { BillingForbiddenError } from "../../server/runtime.js";
import { billingActionErrorMessage, billingOverviewErrorMessage } from "./functions.js";

/**
 * `createServerFn` handlers bundle into a chunk separate from the composition root that throws
 * these errors, so a real cross-chunk error keeps its `name` but loses its class identity by the
 * time it reaches a catch block here — `instanceof` returns false even though the error is
 * "the same" error. A plain `Error` with only the `name` set reproduces exactly that: it is
 * provably not an instance of the real class, matching what survives bundling.
 */
function crossChunkError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

it("maps a cross-chunk TenantRouteNotFoundError to the friendly billing overview message", () => {
  const error = crossChunkError("TenantRouteNotFoundError");
  assert.equal(error instanceof TenantRouteNotFoundError, false);
  assert.equal(billingOverviewErrorMessage(error), "Organization unavailable.");
});

it("maps a cross-chunk BillingForbiddenError to the friendly billing action message", () => {
  const error = crossChunkError("BillingForbiddenError");
  assert.equal(error instanceof BillingForbiddenError, false);
  assert.equal(
    billingActionErrorMessage(error),
    "Only an organization owner or admin can change billing.",
  );
});
