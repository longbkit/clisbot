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
