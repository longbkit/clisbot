import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import { RadioList } from "./channel-route-audience-controls";

/** Label left, control right — the one row shape the behavior block is built from. */
export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={settingsStyles.formRow}>
      <Text style={[settingsStyles.rowTitle, settingsStyles.formRowContent]}>{label}</Text>
      <View style={settingsStyles.formRowControls}>{children}</View>
    </View>
  );
}

export function RouteBehaviorSwitch({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange(value: boolean): void;
  disabled: boolean;
}) {
  return (
    <SettingRow label={label}>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
      />
    </SettingRow>
  );
}

export interface RouteNumberRowProps {
  label: string;
  unit?: string;
  value: string;
  error?: string;
  onChange(text: string): void;
  disabled: boolean;
}

/** Label left, a short number field and its unit right, an error under the row. */
export function RouteNumberRow({
  label,
  unit,
  value,
  error,
  onChange,
  disabled,
}: RouteNumberRowProps) {
  return (
    <View>
      <SettingRow label={label}>
        <View style={styles.numberInput}>
          <FormTextInput
            initialValue={value}
            onChangeText={onChange}
            keyboardType="number-pad"
            accessibilityLabel={label}
            editable={!disabled}
          />
        </View>
        {unit === undefined ? null : <Text style={styles.unit}>{unit}</Text>}
      </SettingRow>
      {error === undefined ? null : <Text style={settingsStyles.rowError}>{error}</Text>}
    </View>
  );
}

/**
 * One choice among a few (docs/design.md): a `SegmentedControl` for short
 * options, a `RadioList` when each option needs its line of detail.
 */
export function ChoiceRow({
  label,
  values,
  selected,
  labels = {},
  descriptions,
  note,
  layout = "stacked",
  onChange,
  disabled,
}: {
  label: string;
  values: string[];
  selected: string;
  labels?: Record<string, string>;
  /** One line per option; makes the choice a radio list. */
  descriptions?: Record<string, string>;
  note?: string;
  /** `row` sits the choices beside the label, level with the switches above. */
  layout?: "stacked" | "row";
  onChange(value: string): void;
  disabled: boolean;
}) {
  const options = values.map((value) => ({
    value,
    label: labels[value] ?? capitalized(value),
    disabled,
    ...(descriptions?.[value] === undefined ? {} : { description: descriptions[value] }),
  }));
  const noteText = note === undefined ? null : <Text style={settingsStyles.rowHint}>{note}</Text>;
  if (descriptions !== undefined) {
    return (
      <View style={styles.choiceGroup}>
        <RadioList
          label={label}
          options={options}
          selected={selected}
          onChange={onChange}
          disabled={disabled}
        />
        {noteText}
      </View>
    );
  }
  const control = (
    <SegmentedControl size="sm" options={options} value={selected} onValueChange={onChange} />
  );
  if (layout === "row") return <SettingRow label={label}>{control}</SettingRow>;
  return (
    <View style={styles.choiceGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.choices}>{control}</View>
      {noteText}
    </View>
  );
}

function capitalized(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create((theme) => ({
  choiceGroup: {
    gap: theme.spacing[2],
  },
  choices: {
    alignItems: "flex-start",
  },
  // A stacked choice group reads as a field whose control is a segmented row, so it
  // uses the same label treatment as every Select and text field around it.
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  numberInput: {
    width: 80,
  },
  unit: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
