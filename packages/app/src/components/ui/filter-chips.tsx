import { useCallback, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
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
  testID,
}: {
  chips: readonly FilterChip<T>[];
  value: T;
  onChange(value: T): void;
  scroll?: boolean;
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
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
      {row}
    </ScrollView>
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
      style={[styles.chip, selected ? styles.selected : null]}
    >
      <Text style={[styles.label, selected ? styles.selectedLabel : null]} numberOfLines={1}>
        {chip.label}
      </Text>
      {counted ? <Text style={styles.count}>{String(chip.count)}</Text> : null}
    </Pressable>
  );
}

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
