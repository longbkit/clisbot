import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";

/**
 * Rollback boundary for the phone session header (docs/features/navigation-v2/README.md): the
 * title opens one sheet with the session's options and its tabs, in place of ⋯ and the switcher.
 * It rides Navigation V2's flag; off, a phone keeps both.
 */
export const PHONE_SESSION_MENU_ENABLED = NAVIGATION_V2_ENABLED;
