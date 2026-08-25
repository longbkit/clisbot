import assert from "node:assert/strict";
import { it } from "vitest";
import { Route } from "./routes/__root.js";

it("limits referrers to same-origin requests so CSRF checks work over HTTP", async () => {
  const head = await Route.options.head?.(undefined!);

  assert.equal(head?.meta?.find((meta) => meta?.name === "referrer")?.content, "same-origin");
});
