// Small controls the audience-rule editor is built from: labelled rows, a row
// folded to its count, and toggle chips.

import React, { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";

export interface AudienceOption {
  id: string;
  name: string;
}

/** Rows that belong to the control above them, indented under it. */
export function NestedRows({ children }: { children: React.ReactNode }) {
  return <View style={styles.nested}>{children}</View>;
}

/** A labelled row whose control sits under the label. */
export function PickerRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.part}>
      <Text style={styles.rowLabel}>{label}</Text>
      {hint === undefined ? null : <Text style={styles.rowHint}>{hint}</Text>}
      {children}
    </View>
  );
}

export function OptionChips({
  options,
  selected,
  disabled,
  onToggle,
  empty,
}: {
  options: readonly AudienceOption[];
  selected: readonly string[];
  disabled: boolean;
  onToggle(id: string): void;
  empty: string;
}) {
  if (options.length === 0) return <Text style={settingsStyles.rowHint}>{empty}</Text>;
  return (
    <View style={styles.chips}>
      {options.map((option) => (
        <ToggleChip
          key={option.id}
          value={option.id}
          label={option.name}
          selected={selected.includes(option.id)}
          disabled={disabled}
          onToggle={onToggle}
        />
      ))}
    </View>
  );
}

export function ToggleChip({
  value,
  label,
  selected,
  disabled,
  onToggle,
}: {
  value: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onToggle(value: string): void;
}) {
  const press = useCallback(() => onToggle(value), [onToggle, value]);
  const state = useMemo(() => ({ selected }), [selected]);
  return (
    <Button
      size="xs"
      variant={selected ? "secondary" : "outline"}
      disabled={disabled}
      onPress={press}
      accessibilityState={state}
    >
      {label}
    </Button>
  );
}

export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

const styles = StyleSheet.create((theme) => ({
  part: { gap: theme.spacing[2] },
  nested: { gap: theme.spacing[3], paddingLeft: theme.spacing[3] },
  // The same label treatment as every Select and text field in this form, so no
  // row looks more important than the picker beside it.
  rowLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  rowHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.4),
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
