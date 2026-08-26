// COMPAT(clisbot-control-plane): runtime verification of the hand-edited
// routeTree.gen.ts channel/user registrations (the file is @ts-nocheck, so
// tsc cannot prove the wiring). Structural + behavioral: the four new route
// ids are registered, the static paths build, the dynamic segment
// substitutes, and the /api/v1/$ splat (public API fallback) is intact.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createMemoryHistory, createRouter, type AnyRoute } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen.js";

function buildRouter() {
  return createRouter({
    // The generated tree's exact generics are irrelevant here; `AnyRoute`
    // keeps the router context optional (a `never` cast would require it).
    routeTree: routeTree as unknown as AnyRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

describe("route tree control-plane wiring", () => {
  it("registers the channel + user routes", () => {
    const router = buildRouter();
    const byId = (router as unknown as { routesById: Record<string, unknown> }).routesById;
    for (const id of [
      "/api/v1/channels",
      "/api/v1/channels/status",
      "/api/v1/users",
      "/api/v1/users/$username",
      "/api/v1/$",
    ]) {
      assert.ok(byId[id], `route id ${id} is not registered`);
    }
  });

  it("builds the channel + user locations through the router", () => {
    const router = buildRouter();
    for (const path of ["/api/v1/channels", "/api/v1/channels/status", "/api/v1/users"]) {
      assert.equal(router.buildLocation({ to: path }).pathname, path);
    }
    // The username is a dynamic segment: the param is substituted into the
    // pathname (an unregistered route would leave the `$username` placeholder).
    const location = router.buildLocation({
      to: "/api/v1/users/$username",
      params: { username: "alice" },
    });
    assert.equal(location.pathname, "/api/v1/users/alice");
  });
});
