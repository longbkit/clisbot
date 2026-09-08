import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The ported `google-auth.runtime.ts` resolves `google-auth-library` through
    // a lazy `import()`, so the first case that touches auth pays for
    // transforming that module graph inside the test body. On a small runner
    // that cold load alone exceeds vitest's 5 s default.
    testTimeout: 30_000,
  },
});
