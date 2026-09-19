import { useCallback, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import type { ChannelRouteBehavior } from "../channel-configuration";

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

/**
 * Follow-up policy for a mention-gated group Route. The caller renders it only
 * when the Route is not a DM and "Require a mention" is on.
 */
export function RouteFollowUpFields({
  behavior,
  followUpTtlDraft,
  followUpTtlError,
  pending,
  changeFollowUpAuto,
  changeFollowUpTtlMinutes,
}: {
  behavior: ChannelRouteBehavior;
  followUpTtlDraft: string;
  followUpTtlError: string | null;
  pending: boolean;
  changeFollowUpAuto(value: boolean): void;
  changeFollowUpTtlMinutes(value: string): void;
}) {
  const auto = behavior.followUpMode === "auto";
  return (
    <>
      <RouteBehaviorSwitch
        label="Continue without a mention"
        value={auto}
        onChange={changeFollowUpAuto}
        disabled={pending}
      />
      {auto ? (
        <Field
          label="Minutes without a mention"
          hint="After the app's last turn, messages here continue without a mention for this many minutes. After that, a new mention is needed."
          error={followUpTtlError}
        >
          <FormTextInput
            initialValue={followUpTtlDraft}
            onChangeText={changeFollowUpTtlMinutes}
            keyboardType="number-pad"
            accessibilityLabel="Minutes without a mention"
            editable={!pending}
          />
        </Field>
      ) : null}
    </>
  );
}

/** A small set of choices shown as buttons, beside the label (`row`) or under it. */
export function ChoiceRow({
  label,
  values,
  selected,
  labels = {},
  note,
  layout = "stacked",
  onChange,
  disabled,
}: {
  label: string;
  values: string[];
  selected: string;
  labels?: Record<string, string>;
  note?: string;
  /** `row` sits the choices beside the label, level with the switches above. */
  layout?: "stacked" | "row";
  onChange(value: string): void;
  disabled: boolean;
}) {
  const choices = (
    <>
      {values.map((value) => (
        <ChoiceButton
          key={value}
          value={value}
          selected={selected === value}
          label={labels[value] ?? capitalized(value)}
          onChange={onChange}
          disabled={disabled}
        />
      ))}
      {note === undefined ? null : <Text style={styles.choiceNote}>{note}</Text>}
    </>
  );
  if (layout === "row") return <SettingRow label={label}>{choices}</SettingRow>;
  return (
    <View style={styles.choiceGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.choices}>{choices}</View>
    </View>
  );
}

function ChoiceButton({
  value,
  selected,
  label,
  onChange,
  disabled,
}: {
  value: string;
  selected: boolean;
  label: string;
  onChange(value: string): void;
  disabled: boolean;
}) {
  const select = useCallback(() => onChange(value), [onChange, value]);
  return (
    <Button
      size="xs"
      variant={selected ? "secondary" : "outline"}
      disabled={disabled}
      onPress={select}
    >
      {label}
    </Button>
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
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  choiceNote: {
    alignSelf: "center",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  // A stacked choice group reads as a field whose control is a button row, so it
  // uses the same label treatment as every Select and text field around it.
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
}));
