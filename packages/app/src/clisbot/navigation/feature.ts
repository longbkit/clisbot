import { HOME_V2_ENABLED } from "@/clisbot/home/feature";

/** Web-only switch for the layout a browser session uses: `"0"` off, `"1"` on. */
export const NAVIGATION_V2_OVERRIDE_KEY = "@clisbot:navigation-v2";

function readOverride(): string | null {
  try {
    return globalThis.localStorage?.getItem(NAVIGATION_V2_OVERRIDE_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Rollback boundary for Navigation V2 (docs/features/navigation-v2/README.md). It nests inside
 * Home V2: `EXPO_PUBLIC_CLISBOT_NAVIGATION_V2=0` restores the Home V2 sidebar and tabs for a build,
 * and the `@clisbot:navigation-v2` localStorage value does it for one browser.
 */
export const NAVIGATION_V2_ENABLED =
  HOME_V2_ENABLED &&
  process.env.EXPO_PUBLIC_CLISBOT_NAVIGATION_V2 !== "0" &&
  readOverride() !== "0";
