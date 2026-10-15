import { StyleSheet } from "react-native-unistyles";
import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";

/** Compact actions paint inside distinct, non-overlapping touch targets. */
export const composerActionGeometry = StyleSheet.create((theme) => ({
  target: {
    width: { xs: MIN_TOUCH_TARGET_SIZE, md: 28 },
    height: { xs: MIN_TOUCH_TARGET_SIZE, md: 28 },
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderRadius: theme.borderRadius.full,
  },
  face: {
    width: { xs: 36, md: 28 },
    height: { xs: 36, md: 28 },
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
  },
  neutral: { backgroundColor: { xs: theme.colors.surface2, md: "transparent" } },
  primary: { backgroundColor: theme.colors.accent },
  recording: { backgroundColor: theme.colors.destructive },
  stop: { backgroundColor: theme.colors.palette.red[600] },
  hovered: { backgroundColor: theme.colors.surface2 },
}));
