// Hub tables and selectable lists share one set of surface steps, so a header,
// a plain row, and a selected row are always three distinct tones. A settings
// card alone is surface1, which is too close to surface2 for either to read.
//
// The steps run in opposite directions per theme, which is the palette working
// as intended: in light, rows (surface0) are lighter than the card and the
// header (surface2) is darker; in dark, surface0 is the darkest tone, so rows
// recede and the header lifts. Both keep three separate tones.

import { StyleSheet } from "react-native-unistyles";

export const tableStyles = StyleSheet.create((theme) => ({
  header: {
    backgroundColor: theme.colors.surface2,
    paddingVertical: theme.spacing[2],
  },
  headerCell: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  body: {
    backgroundColor: theme.colors.surface0,
  },
  hovered: {
    backgroundColor: theme.colors.surface1,
  },
  selected: {
    backgroundColor: theme.colors.surface3,
  },
}));
