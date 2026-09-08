import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The Lark SDK is a large CJS graph and the first case that constructs a
    // client pays for transforming it inside the test body; on a small runner
    // that cold load alone exceeds vitest's 5 s default.
    testTimeout: 30_000,
  },
});
