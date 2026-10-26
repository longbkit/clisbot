import type { Page } from "@playwright/test";

/** The storage override `packages/app/src/clisbot/navigation/feature.ts` reads at boot. */
export const NAVIGATION_V2_OVERRIDE_KEY = "@clisbot:navigation-v2";

/**
 * Pins this page to Navigation V2 (`true`) or the Home V2 sidebar (`false`) on every navigation.
 * Navigation V2 is the app default; specs written against the sidebar pin it off until the flag is
 * removed (docs/features/navigation-v2/README.md#flag-removal). The `test` fixture does this for
 * its own page through the `navigationV2` option; call this for `metroTest` specs and for pages a
 * spec opens itself.
 */
export async function pinNavigationV2(page: Page, enabled: boolean): Promise<void> {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: NAVIGATION_V2_OVERRIDE_KEY,
    value: enabled ? "1" : "0",
  });
}
