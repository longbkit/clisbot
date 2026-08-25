import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { it } from "vitest";
import { configureRuntimeRoot, runtimeFile } from "./runtime-files.js";

it("resolves packaged runtime files from the configured package root", () => {
  const root = resolve("fixtures", "installed-hub");
  const restore = configureRuntimeRoot(root);

  try {
    assert.equal(runtimeFile("drizzle"), join(root, "drizzle"));
    assert.equal(
      runtimeFile(".output", "server", "start-server.js"),
      join(root, ".output", "server", "start-server.js"),
    );
  } finally {
    restore();
  }
});
