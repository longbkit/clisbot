import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ScrollView,
  Text,
  View,
  type AccessibilityRole,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SPACING } from "@/styles/theme";
import { CONTROL_HEIGHTS, MIN_TOUCH_TARGET_SIZE } from "./control-geometry";
import { EdgeFade } from "./edge-fade";
import { PressHighlight } from "./press-highlight";

export interface FilterChip<T extends string> {
  value: T;
  label: string;
  /** Omitted when the count says nothing (an "All" chip, a list that is still loading). */
  count?: number;
}

type ChipBackdrop = "surface0" | "surfaceSidebar";

/**
 * The counts that open a directory tab, each one a filter: pressing "Owners 2" shows the two
 * Owners. The selected chip is the one filter in force; "All" is a chip like the others.
 * `scroll` keeps the chips on one line that scrolls sideways, for narrow list panes.
 */
export function FilterChips<T extends string>({
  chips,
  value,
  onChange,
  scroll = false,
  backdrop = "surface0",
  contentStyle,
  testID,
}: {
  chips: readonly FilterChip<T>[];
  value: T;
  onChange(value: T): void;
  scroll?: boolean;
  /** The surface behind a scrolling row; its trailing edge fades into it. */
  backdrop?: ChipBackdrop;
  /** A scrolling row's inset, as padding, so the chips scroll off the pane's own edge. */
  contentStyle?: ScrollView["props"]["contentContainerStyle"];
  testID?: string;
}) {
  const row = (
    <View style={scroll ? styles.line : styles.row} accessibilityRole="tablist" testID={testID}>
      {chips.map((chip) => (
        <FilterChipButton
          key={chip.value}
          chip={chip}
          selected={chip.value === value}
          onChange={onChange}
          testID={testID ? `${testID}-${chip.value}` : undefined}
        />
      ))}
    </View>
  );
  if (!scroll) return row;
  return (
    <ChipRow backdrop={backdrop} contentStyle={contentStyle}>
      {row}
    </ChipRow>
  );
}

/**
 * One line of chips that scrolls sideways; a fade on either edge says there is more that way.
 * Give it the full pane width and its inset as `contentStyle` padding, so a chip that does not
 * fit runs under the fade at the pane's edge instead of stopping at an inner line.
 */
export function ChipRow({
  backdrop = "surface0",
  contentStyle,
  testID,
  children,
}: {
  backdrop?: ChipBackdrop;
  contentStyle?: ScrollView["props"]["contentContainerStyle"];
  testID?: string;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const [content, setContent] = useState(0);
  const [offset, setOffset] = useState(0);
  const measure = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);
  const measureContent = useCallback((contentWidth: number) => setContent(contentWidth), []);
  const track = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setOffset(event.nativeEvent.contentOffset.x);
  }, []);
  const more = content - width - offset > 1;
  const before = offset > 1;
  return (
    <View style={styles.scrollFrame} onLayout={measure} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={contentStyle}
        onContentSizeChange={measureContent}
        onScroll={track}
        scrollEventThrottle={32}
      >
        {children}
      </ScrollView>
      {before ? (
        <EdgeFade edge="left" solidFraction={0.2} backdrop={backdrop} style={styles.fadeLeft} />
      ) : null}
      {more ? (
        <EdgeFade edge="right" solidFraction={0.2} backdrop={backdrop} style={styles.fade} />
      ) : null}
    </View>
  );
}

function FilterChipButton<T extends string>({
  chip,
  selected,
  onChange,
  testID,
}: {
  chip: FilterChip<T>;
  selected: boolean;
  onChange(value: T): void;
  testID?: string;
}) {
  const press = useCallback(() => onChange(chip.value), [chip.value, onChange]);
  const counted = chip.count !== undefined;
  return (
    <ChipButton
      role="tab"
      label={chip.label}
      count={chip.count}
      selected={selected}
      accessibilityLabel={counted ? `${chip.label} (${String(chip.count)})` : chip.label}
      onPress={press}
      testID={testID}
    />
  );
}

/**
 * The one chip: a compact pill whose press area still reaches the touch target. Filter chips,
 * pin tags and "show more" tags are all this pill.
 */
export function ChipButton({
  label,
  leading,
  count,
  selected = false,
  truncate = false,
  role = "button",
  accessibilityLabel,
  onPress,
  testID,
}: {
  label: string;
  leading?: ReactNode;
  count?: number;
  selected?: boolean;
  /** Long titles (a pinned workspace) stop at a fixed width instead of widening the row. */
  truncate?: boolean;
  role?: Extract<AccessibilityRole, "button" | "tab">;
  accessibilityLabel?: string;
  onPress(): void;
  testID?: string;
}) {
  const state = useMemo(() => ({ selected }), [selected]);
  const style = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.chip,
      truncate && styles.truncate,
      (pressed || hovered) && styles.hovered,
      selected && styles.selected,
    ],
    [selected, truncate],
  );
  return (
    <PressHighlight
      accessibilityRole={role}
      accessibilityState={state}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      testID={testID}
      hitSlop={CHIP_HIT_SLOP}
      style={style}
    >
      {leading}
      <Text
        style={[styles.label, selected && styles.selectedLabel, truncate && styles.labelShrink]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {count !== undefined ? <Text style={styles.count}>{String(count)}</Text> : null}
    </PressHighlight>
  );
}

/** The pill stays `CONTROL_HEIGHTS.tight`; the press area reaches the touch target. */
const CHIP_HIT_SLOP = {
  top: (MIN_TOUCH_TARGET_SIZE - CONTROL_HEIGHTS.tight) / 2,
  bottom: (MIN_TOUCH_TARGET_SIZE - CONTROL_HEIGHTS.tight) / 2,
  left: SPACING[1],
  right: SPACING[1],
};

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  line: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  scroll: { flexGrow: 0 },
  scrollFrame: { position: "relative" },
  fade: {
    position: "absolute",
    top: theme.spacing[0],
    bottom: theme.spacing[0],
    right: theme.spacing[0],
    width: theme.spacing[8],
  },
  fadeLeft: {
    position: "absolute",
    top: theme.spacing[0],
    bottom: theme.spacing[0],
    left: theme.spacing[0],
    width: theme.spacing[8],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minHeight: CONTROL_HEIGHTS.tight,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  truncate: { maxWidth: theme.spacing[32] + theme.spacing[16] },
  hovered: { backgroundColor: theme.colors.surface2 },
  selected: {
    backgroundColor: theme.colors.surface3,
    borderColor: theme.colors.borderAccent,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  labelShrink: { flexShrink: 1 },
  selectedLabel: {
    color: theme.colors.foreground,
  },
  count: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
