import { defineConfig, configDefaults } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import path from "path";
import fs from "fs";

const appNodeModules = path.resolve(__dirname, "node_modules");
const rootNodeModules = path.resolve(__dirname, "../../node_modules");
const resolvePackageEntry = (packageName: string) => {
  const appPackagePath = path.resolve(appNodeModules, packageName);
  return fs.existsSync(appPackagePath)
    ? appPackagePath
    : path.resolve(rootNodeModules, packageName);
};

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "e2e/**"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.{test,spec}.{ts,tsx}", "native-release-version.test.ts"],
          setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
          exclude: [...configDefaults.exclude, "e2e/**", "src/**/*.browser.{test,spec}.{ts,tsx}"],
        },
      },
      {
        extends: true,
        resolve: {
          // Component browser tests have no Expo router host. Route contracts run
          // through Playwright/Metro; avoid scanning native Expo navigation here.
          alias: [
            {
              find: /^expo-router$/,
              replacement: path.resolve(__dirname, "test-stubs/expo-router.ts"),
            },
            // The package's index.js resolves to js/MaskedView.js, which ships
            // `import type` syntax its own toolchain strips but esbuild's
            // dependency optimizer rejects. Point at the plain-JS web entry.
            {
              find: /^@react-native-masked-view\/masked-view$/,
              replacement: resolvePackageEntry(
                "@react-native-masked-view/masked-view/js/MaskedView.web.js",
              ),
            },
          ],
        },
        test: {
          name: "browser",
          fileParallelism: false,
          include: ["src/**/*.browser.{test,spec}.{ts,tsx}"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            connectTimeout: 180_000,
            instances: [{ browser: "chromium" }],
            screenshotDirectory: ".vitest-screenshots",
          },
          globalSetup: path.resolve(__dirname, "src/runtime/websocket-test-global-setup.ts"),
        },
      },
    ],
    /**
     * Expo pulls in native tooling (xcode, etc.) that executes files relying on `process.send`.
     * Vitest's default worker pool uses worker_threads, which intentionally stub that API and
     * immediately throw `Unexpected call to process.send`. Running the suite in forked processes
     * keeps `process.send` intact so the app tests can boot before hitting the intentional failures.
     */
    pool: "forks",
    maxWorkers: 2,
    server: {
      deps: {
        fallbackCJS: true,
        inline: ["zustand", "@tanstack/react-query", "react-native-web"],
      },
    },
  },
  // Reanimated ships one file per platform and picks between them by extension
  // (`findHostInstance.web.js`). Vite's dependency optimizer does not apply `resolve.extensions`,
  // so it scans the native files and dies on imports react-native-web has no answer for.
  // Unbundled, the same imports go through the resolver below and land on the web files.
  optimizeDeps: {
    // react-native-web must be pre-optimized at startup: the react-native alias
    // shim re-exports it by bare specifier from a source file, so the optimizer
    // would otherwise discover it mid-test and reload the browser, breaking vi.mock.
    include: ["react-native-web", "react/jsx-runtime", "react/jsx-dev-runtime", "i18next", "zod"],
    exclude: ["react-native-reanimated"],
  },
  // The app tsconfig sets "jsx": "react-native", which esbuild does not understand and
  // falls back to the classic transform for — emitting bare `React.createElement` calls in
  // files that only import React types. Pin the automatic runtime so JSX transforms are
  // deterministic; `react/jsx-runtime` is pre-optimized above.
  esbuild: { jsx: "automatic" },
  // The globals a React Native bundler defines, which esbuild is no longer there to supply for
  // the package excluded above.
  define: {
    "process.env.JEST_WORKER_ID": "undefined",
    __DEV__: "false",
    global: "globalThis",
  },
  resolve: {
    extensions: [
      ".web.mjs",
      ".web.js",
      ".web.mts",
      ".web.ts",
      ".web.jsx",
      ".web.tsx",
      ".mjs",
      ".js",
      ".mts",
      ".ts",
      ".jsx",
      ".tsx",
      ".json",
    ],
    alias: [
      {
        find: /^@getpaseo\/relay\/e2ee$/,
        replacement: path.resolve(__dirname, "../relay/src/e2ee.ts"),
      },
      {
        find: /^@getpaseo\/relay$/,
        replacement: path.resolve(__dirname, "../relay/src/index.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, "src") },
      // Must precede the `react-native` alias: a string `find` matches by prefix, so this subpath
      // would otherwise resolve inside a react-native-web *file* and break the dependency scan.
      // Reanimated only imports it on the native path, which no test takes.
      {
        find: /^react-native\/Libraries\/Renderer\/shims\/ReactFabric$/,
        replacement: path.resolve(__dirname, "test-stubs/react-native-fabric-shim.ts"),
      },
      // Same prefix-shadowing hazard for the native spec shims that
      // react-native-gesture-handler's prebundle follows.
      {
        find: /^react-native\/Libraries\/Utilities\/codegenNativeComponent$/,
        replacement: path.resolve(__dirname, "test-stubs/rn-codegen-native-component.ts"),
      },
      {
        find: /^react-native\/Libraries\/Pressability\/PressabilityDebug$/,
        replacement: path.resolve(__dirname, "test-stubs/rn-pressability-debug.tsx"),
      },
      {
        find: /^react-native\/Libraries\/ReactNative\/ReactFabricPublicInstance\/ReactFabricPublicInstance$/,
        replacement: path.resolve(__dirname, "test-stubs/rn-react-fabric-public-instance.ts"),
      },
      {
        find: /^react-native\/Libraries\/Renderer\/shims\/ReactNativeViewConfigRegistry$/,
        replacement: path.resolve(__dirname, "test-stubs/rn-view-config-registry.ts"),
      },
      {
        find: /^react-native\/Libraries\/Renderer\/shims\/ReactNative$/,
        replacement: path.resolve(__dirname, "test-stubs/rn-renderer-shims-react-native.ts"),
      },
      // Point at the shim (which re-exports the ESM web build plus inert
      // native-module seams) so Vite can transform its imports and apply the
      // react alias below (the CJS build uses require('react') which bypasses
      // Vite alias resolution).
      {
        find: "react-native",
        replacement: path.resolve(__dirname, "test-stubs/react-native-web-plus.ts"),
      },
      { find: "react", replacement: resolvePackageEntry("react") },
      {
        find: "react-dom",
        replacement: resolvePackageEntry("react-dom"),
      },
      {
        find: /^@xterm\/addon-ligatures\/lib\/addon-ligatures\.mjs$/,
        replacement: path.resolve(__dirname, "test-stubs/xterm-addon-ligatures.ts"),
      },
      {
        find: /^@xterm\/addon-ligatures$/,
        replacement: path.resolve(__dirname, "test-stubs/xterm-addon-ligatures.ts"),
      },
      {
        find: /^react-native-unistyles$/,
        replacement: path.resolve(__dirname, "test-stubs/react-native-unistyles.ts"),
      },
      {
        find: /^react-native-svg$/,
        replacement: path.resolve(__dirname, "test-stubs/react-native-svg.ts"),
      },
      // Both ship untranspiled Flow and fail to parse on import, which takes out any test that
      // mounts a menu surface.
      {
        find: /^react-native-safe-area-context$/,
        replacement: path.resolve(__dirname, "test-stubs/react-native-safe-area-context.ts"),
      },
      {
        find: /^@gorhom\/bottom-sheet$/,
        replacement: path.resolve(__dirname, "test-stubs/gorhom-bottom-sheet.ts"),
      },
      {
        find: /^react-native-reanimated\/scripts\/validate-worklets-version$/,
        replacement: path.resolve(__dirname, "test-stubs/reanimated-validate-worklets-version.ts"),
      },
      {
        find: /^expo-linking$/,
        replacement: path.resolve(__dirname, "test-stubs/expo-linking.ts"),
      },
      // The real packages resolve to Expo module source that needs the native
      // runtime (globalThis.expo); the DOM covers the app's browser usage, and
      // no native module exists for the optional lookups.
      {
        find: /^expo-clipboard$/,
        replacement: path.resolve(__dirname, "test-stubs/expo-clipboard.ts"),
      },
      {
        find: /^expo-constants$/,
        replacement: path.resolve(__dirname, "test-stubs/expo-constants.ts"),
      },
      // Source-only package: bundling its real source drags in expo-modules-core.
      // Must precede the bare expo-file-system alias (string find matches by prefix).
      {
        find: /^expo-file-system\/legacy$/,
        replacement: path.resolve(__dirname, "test-stubs/expo-file-system-legacy.ts"),
      },
      {
        find: /^expo-file-system$/,
        replacement: path.resolve(__dirname, "test-stubs/expo-file-system.ts"),
      },
      {
        find: /^expo-modules-core$/,
        replacement: path.resolve(__dirname, "test-stubs/expo-modules-core.ts"),
      },
      {
        find: /^lucide-react-native$/,
        replacement: path.resolve(__dirname, "test-stubs/lucide-react-native.ts"),
      },
    ],
  },
});
