import assert from "node:assert/strict";
import { it } from "vitest";
import { TenantRouteNotFoundError } from "./access.js";
import { ProjectCommandError } from "./command-error.js";
import {
  commandForbiddenMessage,
  readUnavailableMessage,
  unavailableMessage,
} from "./functions.js";

/**
 * `createServerFn` handlers bundle into a chunk separate from the composition root that throws
 * these errors, so a real cross-chunk error keeps its `name` but loses its class identity by the
 * time it reaches a catch block here — `instanceof` returns false even though the error is "the
 * same" error. A plain `Error` with only the `name` (and, where relevant, `code`) set reproduces
 * exactly that: it is provably not an instance of the real class, matching what survives
 * bundling.
 */
function crossChunkError(name: string, extra?: Record<string, unknown>): Error {
  const error = new Error(name);
  error.name = name;
  return Object.assign(error, extra);
}

it("maps a cross-chunk TenantRouteNotFoundError to the friendly project message", () => {
  const error = crossChunkError("TenantRouteNotFoundError");
  assert.equal(error instanceof TenantRouteNotFoundError, false);
  assert.equal(unavailableMessage(error, true), "Project unavailable.");
  assert.equal(unavailableMessage(error, false), "Organization unavailable.");
});

it("maps a cross-chunk forbidden ProjectCommandError to the friendly permission message", () => {
  const error = crossChunkError("ProjectCommandError", { code: "forbidden" });
  assert.equal(error instanceof ProjectCommandError, false);
  assert.equal(commandForbiddenMessage(error), "You don't have permission to manage this project.");
});

it("describes project and organization read failures as load failures", () => {
  const error = new Error("storage unavailable");
  assert.equal(
    readUnavailableMessage(error, true),
    "Hub couldn't load this project's configuration. Reload the page to try again.",
  );
  assert.equal(
    readUnavailableMessage(error, false),
    "Hub couldn't load this organization. Reload the page to try again.",
  );
});
