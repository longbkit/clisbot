import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Ellipsis } from "lucide-react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const ThemedEllipsis = withUnistyles(Ellipsis);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface BotsSidebarRowProps {
  leading: ReactNode;
  title: string;
  /** Host name when several hosts have bots, as the workspace rows do. */
  subtitle?: string | null;
  trailing?: string | null;
  /** A running session behind the row; drawn as a dot beside the title. */
  active?: boolean;
  selected: boolean;
  testID: string;
  onPress: () => void;
  /** Present: the row gets a kebab (hover on web, always on native and compact). */
  onOpenMenu?: () => void;
  menuLabel?: string;
}

/**
 * One row for both sections. The row and its kebab are sibling `Pressable`s, not nested, so
 * neither hover state machine sees the other; the kebab keeps its slot and only changes opacity
 * (docs/hover.md failure modes 1 and 2). `minHeight` pins the geometry.
 */
export const BotsSidebarRow = memo(function BotsSidebarRow({
  leading,
  title,
  subtitle,
  trailing,
  active = false,
  selected,
  testID,
  onPress,
  onOpenMenu,
  menuLabel,
}: BotsSidebarRowProps) {
  const [rowHovered, setRowHovered] = useState(false);
  const handleHoverIn = useCallback(() => setRowHovered(true), []);
  const handleHoverOut = useCallback(() => setRowHovered(false), []);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (hovered || rowHovered) && styles.rowHovered,
      selected && styles.rowSelected,
      pressed && styles.rowPressed,
    ],
    [rowHovered, selected],
  );
  return (
    <View style={styles.container} testID={testID}>
      <Pressable
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={title}
        accessibilityState={accessibilityState}
        aria-selected={selected}
        onPress={onPress}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        style={rowStyle}
        testID={`${testID}-press`}
      >
        <View style={styles.leadingSlot}>{leading}</View>
        <View style={styles.titleColumn}>
          <View style={styles.titleLine}>
            <Text style={selected ? styles.titleSelected : styles.title} numberOfLines={1}>
              {title}
            </Text>
            {active ? <View style={styles.activeDot} testID={`${testID}-active`} /> : null}
          </View>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {trailing ? <Text style={styles.trailing}>{trailing}</Text> : null}
      </Pressable>
      {onOpenMenu ? (
        <RowKebab
          visible={rowHovered}
          label={menuLabel ?? title}
          onPress={onOpenMenu}
          testID={`${testID}-menu`}
        />
      ) : null}
    </View>
  );
});

function RowKebab({
  visible,
  label,
  onPress,
  testID,
}: {
  visible: boolean;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const isCompact = useIsCompactFormFactor();
  const [focused, setFocused] = useState(false);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  const kebabStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.kebab,
      (isNative || isCompact) && styles.kebabTouch,
      (visible || hovered || focused || isNative || isCompact) && styles.kebabVisible,
      (hovered || pressed) && styles.kebabHovered,
    ],
    [focused, isCompact, visible],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={kebabStyle}
      testID={testID}
      hitSlop={4}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <ThemedEllipsis size={14} uniProps={mutedColorMapping} />
    </Pressable>
  );
}

const TITLE_LINE_HEIGHT = 20;

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.spacing[0.5],
  },
  row: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    userSelect: "none",
  },
  rowHovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  rowSelected: { backgroundColor: theme.colors.surfaceSidebarSelected },
  rowPressed: { backgroundColor: theme.colors.surface2 },
  leadingSlot: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  titleColumn: { flex: 1, minWidth: 0 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  title: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: TITLE_LINE_HEIGHT,
  },
  titleSelected: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: TITLE_LINE_HEIGHT,
  },
  subtitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  trailing: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: TITLE_LINE_HEIGHT,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.statusDotRunning,
    flexShrink: 0,
  },
  kebab: {
    width: 32,
    height: 32,
    marginRight: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    opacity: 0,
  },
  kebabTouch: { width: 44, height: 44 },
  kebabVisible: { opacity: 1 },
  kebabHovered: { backgroundColor: theme.colors.surface2 },
}));
