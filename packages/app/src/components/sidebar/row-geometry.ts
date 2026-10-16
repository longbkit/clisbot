import type { Theme } from "@/styles/theme";

/** Reserve the same column for avatars, type glyphs and status marks at each sidebar level. */
export function sidebarLeadingColumnWidth(theme: Theme): number {
  return theme.spacing[8];
}
