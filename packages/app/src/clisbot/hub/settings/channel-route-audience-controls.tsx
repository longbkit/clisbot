// Small controls the audience-rule editor is built from: labelled rows, a row
// folded to its count, and toggle chips.

import React, { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";

export interface AudienceOption {
  id: string;
  name: string;
}

/** A labelled row whose control sits under the label. */
export function PickerRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.part}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

/** A labelled row folded to its count; it opens on its own when it holds a value. */
export function DisclosureRow({
  label,
  count,
  disabled,
  children,
}: {
  label: string;
  count: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(count > 0);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const state = useMemo(() => ({ expanded: open }), [open]);
  return (
    <View style={styles.part}>
      <View style={styles.disclosureHeader}>
        <Text style={styles.rowLabel}>{count > 0 ? `${label} (${String(count)})` : label}</Text>
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled}
          onPress={toggle}
          accessibilityState={state}
          accessibilityLabel={`${open ? "Hide" : "Choose"} ${label}`}
        >
          {open ? "Hide" : "Choose"}
        </Button>
      </View>
      {open ? children : null}
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
  disclosureHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rowLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
