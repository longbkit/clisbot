import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The ported `channel-actions.ts` reaches its action runtime through
    // upstream's lazy `import("./actions/runtime.js")`, so the first action a
    // suite dispatches pays for transforming that module graph inside the test
    // body. On a small runner that cold load alone exceeds vitest's 5 s default.
    testTimeout: 30_000,
  },
});
