import type { Rect } from "@/components/ui/menu/menu-anchor";
import { memo, useRef, useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MoreVertical } from "lucide-react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const ThemedMoreVertical = withUnistyles(MoreVertical);
const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

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
  /** Menu replaces the trailing metadata on hover/focus; touch keeps it visible. */
  onOpenMenu?: (anchor: Rect) => void;
  menuLabel?: string;
}

/** Shared bot/chat row; hover belongs to the outer View, as with workspace rows. */
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
  const compact = useIsCompactFormFactor() || isNative;
  const [rowHovered, setRowHovered] = useState(false);
  const [menuFocused, setMenuFocused] = useState(false);
  const menuVisible = Boolean(onOpenMenu && (rowHovered || menuFocused || compact));
  const handleHoverIn = useCallback(() => setRowHovered(true), []);
  const handleHoverOut = useCallback(() => setRowHovered(false), []);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      compact && styles.rowTouch,
      (hovered || rowHovered) && styles.rowHovered,
      selected && styles.rowSelected,
      pressed && styles.rowPressed,
    ],
    [rowHovered, selected, compact],
  );
  return (
    <View
      style={styles.container}
      testID={testID}
      onPointerEnter={handleHoverIn}
      onPointerLeave={handleHoverOut}
    >
      <Pressable
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={title}
        accessibilityState={accessibilityState}
        aria-selected={selected}
        onPress={onPress}
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
        {onOpenMenu || trailing ? (
          <View style={[styles.trailingSlot, compact && styles.trailingSlotTouch]}>
            {trailing ? (
              <Text style={[styles.trailing, menuVisible && styles.trailingHidden]}>
                {trailing}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>
      {onOpenMenu ? (
        <RowKebab
          visible={menuVisible}
          onFocusChange={setMenuFocused}
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
  onFocusChange,
  label,
  onPress,
  testID,
}: {
  visible: boolean;
  onFocusChange: (focused: boolean) => void;
  label: string;
  onPress: (anchor: Rect) => void;
  testID: string;
}) {
  const isCompact = useIsCompactFormFactor();
  const trigger = useRef<View>(null);
  const open = useCallback(
    () =>
      trigger.current?.measureInWindow((x, y, width, height) => onPress({ x, y, width, height })),
    [onPress],
  );
  const onFocus = useCallback(() => onFocusChange(true), [onFocusChange]);
  const onBlur = useCallback(() => onFocusChange(false), [onFocusChange]);
  const kebabStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.kebab,
      (isNative || isCompact) && styles.kebabTouch,
      (visible || hovered || isNative || isCompact) && styles.kebabVisible,
      (hovered || pressed) && styles.kebabHovered,
    ],
    [isCompact, visible],
  );
  return (
    <View style={styles.kebabContainer} pointerEvents="box-none">
      <Pressable
        ref={trigger}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={open}
        style={kebabStyle}
        testID={testID}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <ThemedMoreVertical size={isCompact || isNative ? 18 : 14} uniProps={mutedColorMapping} />
      </Pressable>
    </View>
  );
}

const TITLE_LINE_HEIGHT = 20;

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "relative",
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
  rowTouch: { minHeight: 44 },
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
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
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
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  trailingSlot: {
    minWidth: 28,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  trailingSlotTouch: { minWidth: 40 },
  trailingHidden: { opacity: 0 },
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
  kebabContainer: {
    position: "absolute",
    right: 4,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  kebab: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    opacity: 0,
  },
  kebabTouch: { width: 44, height: 44 },
  kebabVisible: { opacity: 1 },
  kebabHovered: { backgroundColor: theme.colors.surface2 },
}));
