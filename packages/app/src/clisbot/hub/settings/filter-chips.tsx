import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export interface FilterChip<T extends string> {
  value: T;
  label: string;
  count: number;
}

/**
 * The counts that open a directory tab, each one a filter: pressing "Owners 2" shows the two
 * Owners. The selected chip is the one filter in force; "All" is a chip like the others.
 */
export function FilterChips<T extends string>({
  chips,
  value,
  onChange,
}: {
  chips: readonly FilterChip<T>[];
  value: T;
  onChange(value: T): void;
}) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {chips.map((chip) => (
        <Chip key={chip.value} chip={chip} selected={chip.value === value} onChange={onChange} />
      ))}
    </View>
  );
}

function Chip<T extends string>({
  chip,
  selected,
  onChange,
}: {
  chip: FilterChip<T>;
  selected: boolean;
  onChange(value: T): void;
}) {
  const press = useCallback(() => onChange(chip.value), [chip.value, onChange]);
  const state = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={state}
      accessibilityLabel={`${chip.label} (${String(chip.count)})`}
      onPress={press}
      style={[styles.chip, selected ? styles.selected : null]}
    >
      <Text style={[styles.label, selected ? styles.selectedLabel : null]}>{chip.label}</Text>
      <Text style={styles.count}>{String(chip.count)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
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
