import { afterAll, beforeAll, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const appRoot = path.resolve(__dirname, "..");
const autolinking = path.join(
  path.dirname(require.resolve("expo-modules-autolinking/package.json")),
  "bin/expo-modules-autolinking.js",
);
const firebaseModules = ["@react-native-firebase/app", "@react-native-firebase/analytics"];
let fixture: string;
let configFile: string;

beforeAll(() => {
  fixture = mkdtempSync(path.join(tmpdir(), "clisbot-native-analytics-"));
  configFile = path.join(fixture, "config.json");
  // Autolinking only checks existence; no real Firebase credentials are needed.
  writeFileSync(configFile, "{}");
});
afterAll(() => rmSync(fixture, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));

function linkedDependencies(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  const output = execFileSync(
    process.execPath,
    [
      autolinking,
      "react-native-config",
      "--project-root",
      appRoot,
      "--platform",
      "android",
      "--json",
    ],
    {
      cwd: appRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        APP_VARIANT: "production",
        CLISBOT_FDROID_BUILD: "0",
        EXPO_PUBLIC_CLISBOT_ANALYTICS: "1",
        GOOGLE_SERVICES_FILE_PROD: configFile,
        GOOGLE_SERVICE_INFO_PLIST_PROD: configFile,
        ...overrides,
      },
    },
  );
  return JSON.parse(output).dependencies as Record<
    string,
    { root: string; platforms: { android: { sourceDir: string; cmakeListsPath: string } } }
  >;
}

test("configured Firebase keeps each library's shipped native CMake definition", () => {
  const linked = linkedDependencies();
  for (const name of firebaseModules) {
    const dependency = linked[name]!;
    const upstream = require(path.join(dependency.root, "react-native.config.js"));
    const android = dependency.platforms.android;
    expect(android.cmakeListsPath).toBe(
      path.resolve(android.sourceDir, upstream.dependency.platforms.android.cmakeListsPath),
    );
    expect(existsSync(android.cmakeListsPath)).toBe(true);
  }
});

test.each([
  { APP_VARIANT: "development" },
  { EXPO_PUBLIC_CLISBOT_ANALYTICS: "0" },
  { CLISBOT_FDROID_BUILD: "1" },
  { GOOGLE_SERVICES_FILE_PROD: path.join(tmpdir(), "missing-clisbot-firebase-config") },
])("unconfigured or disabled analytics excludes Firebase: %j", (overrides) => {
  const linked = linkedDependencies(overrides);
  for (const name of firebaseModules) expect(linked[name]).toBeUndefined();
});
