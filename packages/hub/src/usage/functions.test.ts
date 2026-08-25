import assert from "node:assert/strict";
import { it } from "vitest";
import { TenantRouteNotFoundError } from "../projects/access.js";
import { usageSnapshotErrorMessage } from "./functions.js";

/**
 * `createServerFn` handlers bundle into a chunk separate from the composition root that throws
 * this error, so a real cross-chunk error keeps its `name` but loses its class identity by the
 * time it reaches a catch block here — `instanceof` returns false even though the error is "the
 * same" error. A plain `Error` with only the `name` set reproduces exactly that: it is provably
 * not an instance of the real class, matching what survives bundling.
 */
function crossChunkError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

it("maps a cross-chunk TenantRouteNotFoundError to the friendly usage message", () => {
  const error = crossChunkError("TenantRouteNotFoundError");
  assert.equal(error instanceof TenantRouteNotFoundError, false);
  assert.equal(usageSnapshotErrorMessage(error), "Organization unavailable.");
});
