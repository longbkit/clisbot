import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { EdgeFade } from "./edge-fade";
import { StyleSheet } from "react-native-unistyles";

export interface FilterChip<T extends string> {
  value: T;
  label: string;
  /** Omitted when the count says nothing (an "All" chip, a list that is still loading). */
  count?: number;
}

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
  testID,
}: {
  chips: readonly FilterChip<T>[];
  value: T;
  onChange(value: T): void;
  scroll?: boolean;
  /** The surface behind a scrolling row; its trailing edge fades into it. */
  backdrop?: "surface0" | "surfaceSidebar";
  testID?: string;
}) {
  const row = (
    <View style={scroll ? styles.line : styles.row} accessibilityRole="tablist" testID={testID}>
      {chips.map((chip) => (
        <Chip
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
  return <ScrollingChips backdrop={backdrop}>{row}</ScrollingChips>;
}

/** One line that scrolls sideways; a fade on the trailing edge says there is more. */
function ScrollingChips({
  backdrop,
  children,
}: {
  backdrop: "surface0" | "surfaceSidebar";
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
  return (
    <View style={styles.scrollFrame} onLayout={measure}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        onContentSizeChange={measureContent}
        onScroll={track}
        scrollEventThrottle={32}
      >
        {children}
      </ScrollView>
      {more ? (
        <EdgeFade edge="right" solidFraction={0} backdrop={backdrop} style={styles.fade} />
      ) : null}
    </View>
  );
}

function Chip<T extends string>({
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
  const state = useMemo(() => ({ selected }), [selected]);
  const counted = chip.count !== undefined;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={state}
      accessibilityLabel={counted ? `${chip.label} (${String(chip.count)})` : chip.label}
      onPress={press}
      testID={testID}
      // The pill stays compact; the press area reaches 44pt.
      hitSlop={CHIP_HIT_SLOP}
      style={[styles.chip, selected ? styles.selected : null]}
    >
      <Text style={[styles.label, selected ? styles.selectedLabel : null]} numberOfLines={1}>
        {chip.label}
      </Text>
      {counted ? <Text style={styles.count}>{String(chip.count)}</Text> : null}
    </Pressable>
  );
}

const CHIP_HIT_SLOP = { top: 8, bottom: 8, left: 2, right: 2 };

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
  fade: { position: "absolute", top: 0, bottom: 0, right: 0, width: theme.spacing[8] },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  selected: {
    backgroundColor: theme.colors.surface3,
    borderColor: theme.colors.borderAccent,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  selectedLabel: {
    color: theme.colors.foreground,
  },
  count: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
