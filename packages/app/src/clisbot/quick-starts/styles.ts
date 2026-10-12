import { StyleSheet } from "react-native-unistyles";
import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
export const styles = StyleSheet.create((t) => ({
  section: {
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  body: { gap: t.spacing[4] },
  group: { gap: t.spacing[3] },
  libraryGroup: { gap: t.spacing[1] },
  groupLabel: {
    color: t.colors.foregroundMuted,
    fontSize: t.fontSize.sm,
    fontWeight: t.fontWeight.medium,
    marginBottom: t.spacing[1],
  },
  empty: {
    alignItems: "center",
    gap: t.spacing[1],
    paddingVertical: t.spacing[8],
  },
  centered: { textAlign: "center" },
  toolbar: { flexDirection: "row", alignItems: "center", gap: t.spacing[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: t.spacing[2],
  },
  grow: { flex: 1, minWidth: 0 },
  label: {
    color: t.colors.foreground,
    fontSize: t.fontSize.base,
    fontWeight: t.fontWeight.medium,
  },
  text: { color: t.colors.foreground, fontSize: t.fontSize.base },
  detail: { color: t.colors.foregroundMuted, fontSize: t.fontSize.sm },
  error: { color: t.colors.destructive, fontSize: t.fontSize.sm },
  prompt: { minHeight: 120, textAlignVertical: "top" },
  grid: { gap: t.spacing[2] },
  gridRow: { flexDirection: "row", gap: t.spacing[2] },
  tile: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.borderRadius.lg,
    // A quiet card on the page; hover fills it, as every other row on Home does.
    backgroundColor: t.colors.surfaceWorkspace,
    borderWidth: t.borderWidth[1],
    borderColor: t.colors.borderSubtle,
    minHeight: MIN_TOUCH_TARGET_SIZE,
  },
  // An empty avatar slot: the tile's other marks are 24px avatars on the same rail.
  actionGlyph: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: t.borderRadius.md,
    borderWidth: t.borderWidth[1],
    borderColor: t.colors.border,
  },
  tileHovered: { backgroundColor: t.colors.interactionHighlight },
  // Same horizontal padding as a tile: flex-basis 0 still counts padding, so an unpadded
  // spacer would leave a short last row's tile wider than the tiles above it. Same for the border.
  tileSpacer: {
    flex: 1,
    paddingHorizontal: t.spacing[3],
    borderWidth: t.borderWidth[1],
    borderColor: "transparent",
  },
  libraryRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: MIN_TOUCH_TARGET_SIZE,
  },
  use: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing[3],
    paddingVertical: t.spacing[2],
  },
  more: {
    minWidth: MIN_TOUCH_TARGET_SIZE,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: t.borderRadius.md,
  },
}));
