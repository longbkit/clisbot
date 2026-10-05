// Small controls the Rule editor is built from: a radio list for one choice
// among a few that each need a line of detail.

import React, { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export interface AudienceOption {
  id: string;
  name: string;
}

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  /** One line under the label: who it lets in, what it covers. */
  description?: string;
}

/** One choice among a few, stacked, each with its line of detail. */
export function RadioList<T extends string>({
  label,
  options,
  selected,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly RadioOption<T>[];
  selected: T;
  onChange(value: T): void;
  disabled: boolean;
}) {
  return (
    <View style={styles.part}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.radios}>
        {options.map((option) => (
          <RadioRow
            key={option.value}
            option={option}
            selected={option.value === selected}
            onChange={onChange}
            disabled={disabled}
          />
        ))}
      </View>
    </View>
  );
}

function RadioRow<T extends string>({
  option,
  selected,
  onChange,
  disabled,
}: {
  option: RadioOption<T>;
  selected: boolean;
  onChange(value: T): void;
  disabled: boolean;
}) {
  const press = useCallback(() => onChange(option.value), [onChange, option.value]);
  const state = useMemo(() => ({ checked: selected, disabled }), [disabled, selected]);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={option.label}
      aria-checked={selected}
      accessibilityState={state}
      disabled={disabled}
      onPress={press}
      style={styles.radioRow}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.dot} /> : null}
      </View>
      <View style={styles.radioText}>
        <Text style={styles.radioLabel}>{option.label}</Text>
        {option.description === undefined ? null : (
          <Text style={styles.rowHint}>{option.description}</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  part: { gap: theme.spacing[2] },
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
  radios: { gap: theme.spacing[1] },
  radioRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  radioText: { flex: 1, minWidth: 0, gap: theme.spacing[0.5] },
  radioLabel: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  radio: {
    width: 16,
    height: 16,
    marginTop: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: theme.colors.foreground },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.foreground },
}));
