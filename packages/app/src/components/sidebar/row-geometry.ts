import type { Theme } from "@/styles/theme";

/** Reserve the same column for avatars, type glyphs and status marks at each sidebar level. */
export function sidebarLeadingColumnWidth(theme: Theme): number {
  return theme.spacing[8];
}

/**
 * A two-line list row (title and detail) in Navigation V2: the Workspace row's height, 8px
 * vertical padding around a 20px title and its detail line. Chats and the Home feed match it.
 */
export const SIDEBAR_TWO_LINE_ROW_HEIGHT = 52;

/**
 * Navigation V2's flat lists (Chats, Home, Workspace's Session and Workspace grouping): a row's
 * fill starts 4px from the pane and its mark column at 12px, the inset of the controls above it,
 * so the title sits at 52px. Each list's own padding is 8px (12px on Home); rows pull out by the
 * difference instead of the list changing its padding, which the controls in its header share.
 */
export const FLAT_ROW_FILL_INSET = 4;
