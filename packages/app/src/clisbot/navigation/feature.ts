import { HOME_V2_ENABLED } from "@/clisbot/home/feature";

/**
 * Rollback boundary for Navigation V2 (docs/features/navigation-v2/README.md). It nests inside
 * Home V2, so `EXPO_PUBLIC_CLISBOT_NAVIGATION_V2=0` restores the Home V2 sidebar and tabs.
 */
export const NAVIGATION_V2_ENABLED =
  HOME_V2_ENABLED && process.env.EXPO_PUBLIC_CLISBOT_NAVIGATION_V2 !== "0";
