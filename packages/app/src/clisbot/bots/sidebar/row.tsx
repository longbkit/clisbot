import { sidebarLeadingColumnWidth } from "@/components/sidebar/row-geometry";
import { SidebarStatusDot } from "@/components/agent-status-dot";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getStatusBucketLabel } from "@/hooks/sidebar-status-view-model";
import { useTranslation } from "react-i18next";
import type { Rect } from "@/components/ui/anchor";
import { memo, useRef, useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MoreVertical } from "lucide-react-native";
import { PinMark } from "@/components/ui/pin-mark";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { sectionRowIndent } from "./section-header";

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
  statusBucket?: SidebarStateBucket;
  statusLabel?: string;
  disabled?: boolean;
  selected: boolean;
  testID: string;
  onPress?: () => void;
  /** Menu replaces the trailing metadata on hover/focus; touch keeps it visible. */
  onOpenMenu?: (anchor: Rect) => void;
  menuLabel?: string;
  /** Navigation V2 floats pinned rows to the top of Chats; the mark says why it is there. */
  pinned?: boolean;
}

/** Shared bot/chat row; hover belongs to the outer View, as with workspace rows. */
export const BotsSidebarRow = memo(function BotsSidebarRow({
  leading,
  title,
  subtitle,
  trailing,
  active = false,
  statusBucket,
  statusLabel: labelOverride,
  disabled = false,
  selected,
  testID,
  onPress,
  onOpenMenu,
  menuLabel,
  pinned = false,
}: BotsSidebarRowProps) {
  const { t } = useTranslation();
  const bucket = statusBucket ?? (active ? "running" : "done");
  const statusLabel = labelOverride ?? getStatusBucketLabel(bucket, t);
  const compact = useIsCompactFormFactor() || isNative;
  const [rowHovered, setRowHovered] = useState(false);
  const [menuFocused, setMenuFocused] = useState(false);
  const menuVisible = Boolean(onOpenMenu && (rowHovered || menuFocused || compact));
  const handleHoverIn = useCallback(() => setRowHovered(true), []);
  const handleHoverOut = useCallback(() => setRowHovered(false), []);
  const accessibilityState = useMemo(() => ({ selected, disabled }), [selected, disabled]);
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
        accessibilityLabel={`${title}, ${statusLabel}`}
        accessibilityState={accessibilityState}
        aria-selected={selected}
        onPress={onPress}
        disabled={disabled}
        style={rowStyle}
        testID={`${testID}-press`}
      >
        <View style={styles.leadingSlot}>{leading}</View>
        <View style={styles.titleColumn}>
          <View style={styles.titleLine}>
            <Text style={selected ? styles.titleSelected : styles.title} numberOfLines={1}>
              {title}
            </Text>
            <View testID={`${testID}-status-${bucket}`}>
              <SidebarStatusDot bucket={bucket} />
            </View>
          </View>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {onOpenMenu || trailing || pinned ? (
          <RowTrailing
            compact={compact}
            pinned={pinned}
            trailing={trailing}
            hidden={menuVisible}
            testID={testID}
          />
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

/** The time and pin mark at a row's end; the kebab covers them while it shows. */
function RowTrailing({
  compact,
  pinned,
  trailing,
  hidden,
  testID,
}: {
  compact: boolean;
  pinned: boolean;
  trailing?: string | null;
  hidden: boolean;
  testID: string;
}) {
  return (
    <View style={[styles.trailingSlot, compact && styles.trailingSlotTouch]}>
      {pinned ? (
        <View style={[styles.pinMark, hidden && styles.trailingHidden]} testID={`${testID}-pinned`}>
          <PinMark />
        </View>
      ) : null}
      {trailing ? (
        <Text style={[styles.trailing, hidden && styles.trailingHidden]}>{trailing}</Text>
      ) : null}
    </View>
  );
}

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

/**
 * The Bot/Chat mark beside a row: as tall as the title and subtitle together when the row has
 * both, the small icon size when the row is a single line.
 */
export function sidebarMarkSize(hasSubtitle: boolean): number {
  return hasSubtitle ? 32 : 20;
}

const styles = StyleSheet.create((theme) => ({
  pinMark: { marginRight: theme.spacing[1] },
  container: {
    position: "relative",
    marginBottom: theme.spacing[0.5],
    paddingLeft: sectionRowIndent(theme),
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
  rowSelected: { backgroundColor: theme.colors.surfaceSidebarSelected, ...theme.shadow.raised },
  rowPressed: { backgroundColor: theme.colors.surface2 },
  // Avatar size or unavailable glyph size never changes the title rail.
  leadingSlot: {
    width: sidebarLeadingColumnWidth(theme),
    minHeight: theme.iconSize.md,
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
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: TITLE_LINE_HEIGHT,
  },
  titleSelected: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    lineHeight: TITLE_LINE_HEIGHT,
  },
  subtitle: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  trailingSlot: {
    minWidth: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  trailingSlotTouch: { minWidth: 40 },
  trailingHidden: { opacity: 0 },
  trailing: {
    flexShrink: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
    lineHeight: TITLE_LINE_HEIGHT,
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
