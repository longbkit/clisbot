import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ScheduleCadence } from "@clisbot/protocol/schedule/types";
import { Button } from "@/components/ui/button";
import { createControlGeometry, type FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import {
  SegmentedControl,
  segmentedLabelStyle,
  segmentedSegmentStyle,
  type SegmentedControlOption,
} from "@/components/ui/segmented-control";
import { normalizeScheduleFormCadence } from "@/schedules/schedule-cadence-options";
import { getDeviceTimeZone } from "@/utils/device-timezone";
import { describeCron, validateCron } from "@/utils/schedule-format";
import {
  choiceError,
  choiceFromCron,
  cronFromChoice,
  EVERY_STEPS,
  QUICK_PICKS,
  type CadenceChoice,
  type CadenceMode,
  type EveryUnit,
} from "./cadence-choice";

export interface CadencePickerProps {
  value: ScheduleCadence;
  onChange: (next: ScheduleCadence) => void;
  /** The caller's cron check; shown for Custom, where the expression is typed. */
  error?: string;
  size?: FieldControlSize;
}

/** Monday first; cron numbers, 0 = Sunday. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * Repeat: every N minutes or hours, daily at a time, weekly on chosen days, or a cron expression,
 * with one-press picks for the common ones. Writes cron in the cadence's timezone (the device's
 * for a new schedule), as the upstream editor it replaces in Clisbot screens.
 */
export function CadencePicker({ value, onChange, error, size = "md" }: CadencePickerProps) {
  const { t } = useTranslation();
  const timezone = useMemo(
    () => normalizeScheduleFormCadence(value, getDeviceTimeZone()).timezone ?? "UTC",
    [value],
  );
  const [choice, setChoice] = useState<CadenceChoice>(() =>
    choiceFromCron(normalizeScheduleFormCadence(value, timezone).expression),
  );
  // Text inputs keep what is typed; a pick or a mode switch starts them over.
  const [version, setVersion] = useState(0);
  const apply = useCallback(
    (next: CadenceChoice, restart = false) => {
      setChoice(next);
      if (restart) setVersion((current) => current + 1);
      onChange({ type: "cron", expression: cronFromChoice(next) ?? "", timezone });
    },
    [onChange, timezone],
  );
  const setMode = useCallback(
    (mode: CadenceMode) =>
      apply({ ...choice, mode, expression: cronFromChoice(choice) ?? choice.expression }, true),
    [apply, choice],
  );
  const pick = useCallback(
    (expression: string) => apply(choiceFromCron(expression), true),
    [apply],
  );
  return (
    <Field label={t("heartbeats.cadence.label")}>
      <View style={styles.stack}>
        <ModeControl value={choice.mode} onChange={setMode} />
        <ModeFields choice={choice} onChange={apply} size={size} version={version} />
        <QuickPicks onPick={pick} />
        <Feedback choice={choice} timezone={timezone} error={error} />
      </View>
    </Field>
  );
}

function ModeControl({
  value,
  onChange,
}: {
  value: CadenceMode;
  onChange: (mode: CadenceMode) => void;
}): ReactElement {
  const { t } = useTranslation();
  const options = useMemo<SegmentedControlOption<CadenceMode>[]>(
    () =>
      (["every", "daily", "weekly", "custom"] as const).map((mode) => ({
        value: mode,
        label: t(`heartbeats.cadence.modes.${mode}`),
        testID: `cadence-mode-${mode}`,
      })),
    [t],
  );
  return (
    <SegmentedControl
      options={options}
      value={value}
      onValueChange={onChange}
      size="sm"
      variant="track"
      style={styles.modes}
    />
  );
}

function ModeFields({
  choice,
  onChange,
  size,
  version,
}: {
  choice: CadenceChoice;
  onChange: (next: CadenceChoice) => void;
  size: FieldControlSize;
  version: number;
}): ReactElement {
  const { t } = useTranslation();
  const set = useCallback(
    (patch: Partial<CadenceChoice>) => onChange({ ...choice, ...patch }),
    [choice, onChange],
  );
  const setAmount = useCallback((amount: string) => set({ amount }), [set]);
  const setUnit = useCallback((unit: EveryUnit) => set({ unit }), [set]);
  const setTime = useCallback((time: string) => set({ time }), [set]);
  const setDays = useCallback((days: number[]) => set({ days }), [set]);
  const setExpression = useCallback((expression: string) => set({ expression }), [set]);
  if (choice.mode === "every") {
    return (
      <View style={styles.row}>
        <View style={styles.amount}>
          <FormTextInput
            size={size}
            initialValue={choice.amount}
            resetKey={`amount-${version}`}
            onChangeText={setAmount}
            keyboardType="number-pad"
            accessibilityLabel={t("heartbeats.cadence.amount")}
            testID="cadence-amount"
          />
        </View>
        <UnitControl value={choice.unit} onChange={setUnit} />
      </View>
    );
  }
  if (choice.mode === "custom") {
    return (
      <FormTextInput
        size={size}
        initialValue={choice.expression}
        resetKey={`cron-${version}`}
        onChangeText={setExpression}
        placeholder="0 7 * * 1"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        accessibilityLabel={t("heartbeats.cadence.cron")}
        style={styles.cron}
        testID="cadence-cron"
      />
    );
  }
  return (
    <View style={styles.row}>
      {choice.mode === "weekly" ? <DaysControl value={choice.days} onChange={setDays} /> : null}
      <Text style={styles.at}>{t("heartbeats.cadence.at")}</Text>
      <View style={styles.time}>
        <FormTextInput
          size={size}
          initialValue={choice.time}
          resetKey={`time-${version}`}
          onChangeText={setTime}
          placeholder="07:00"
          accessibilityLabel={t("heartbeats.cadence.time")}
          testID="cadence-time"
        />
      </View>
    </View>
  );
}

function UnitControl({
  value,
  onChange,
}: {
  value: EveryUnit;
  onChange: (unit: EveryUnit) => void;
}): ReactElement {
  const { t } = useTranslation();
  const options = useMemo<SegmentedControlOption<EveryUnit>[]>(
    () => [
      { value: "minutes", label: t("heartbeats.cadence.minutes"), testID: "cadence-unit-minutes" },
      { value: "hours", label: t("heartbeats.cadence.hours"), testID: "cadence-unit-hours" },
    ],
    [t],
  );
  return <SegmentedControl options={options} value={value} onValueChange={onChange} size="sm" />;
}

/** Several days at once, so a row of toggles in the segmented rail rather than one segment. */
function DaysControl({
  value,
  onChange,
}: {
  value: readonly number[];
  onChange: (days: number[]) => void;
}): ReactElement {
  const { i18n } = useTranslation();
  const labels = useMemo(() => weekdayLabels(i18n.language), [i18n.language]);
  const toggle = useCallback(
    (day: number) =>
      onChange(value.includes(day) ? value.filter((entry) => entry !== day) : [...value, day]),
    [onChange, value],
  );
  return (
    <View style={styles.daysTrack} accessibilityRole="toolbar">
      {WEEK.map((day) => (
        <DayToggle
          key={day}
          day={day}
          label={labels[day]!}
          selected={value.includes(day)}
          onToggle={toggle}
        />
      ))}
    </View>
  );
}

function DayToggle({
  day,
  label,
  selected,
  onToggle,
}: {
  day: number;
  label: string;
  selected: boolean;
  onToggle: (day: number) => void;
}): ReactElement {
  const handlePress = useCallback(() => onToggle(day), [day, onToggle]);
  const state = useMemo(() => ({ checked: selected }), [selected]);
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) =>
      segmentedSegmentStyle({
        size: "sm",
        variant: "track",
        selected,
        hovered: Boolean(hovered),
        pressed,
      }),
    [selected],
  );
  return (
    <Pressable
      onPress={handlePress}
      style={style}
      accessibilityRole="checkbox"
      accessibilityState={state}
      testID={`cadence-day-${day}`}
    >
      <Text style={segmentedLabelStyle({ size: "sm", selected, variant: "track" })}>{label}</Text>
    </Pressable>
  );
}

function QuickPicks({ onPick }: { onPick: (expression: string) => void }): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.quick}>
      {QUICK_PICKS.map((option) => (
        <QuickPick
          key={option.key}
          label={t(`heartbeats.cadence.quick.${option.key}`)}
          expression={option.expression}
          onPick={onPick}
          testID={`cadence-quick-${option.key}`}
        />
      ))}
    </View>
  );
}

function QuickPick({
  label,
  expression,
  onPick,
  testID,
}: {
  label: string;
  expression: string;
  onPick: (expression: string) => void;
  testID: string;
}): ReactElement {
  const handlePress = useCallback(() => onPick(expression), [expression, onPick]);
  return (
    <Button variant="outline" size="xs" onPress={handlePress} testID={testID}>
      {label}
    </Button>
  );
}

function Feedback({
  choice,
  timezone,
  error,
}: {
  choice: CadenceChoice;
  timezone: string;
  error?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const problem = choiceError(choice);
  if (problem) {
    const values = EVERY_STEPS[choice.unit].join(", ");
    return (
      <Text style={styles.error}>{t(`heartbeats.cadence.errors.${problem}`, { values })}</Text>
    );
  }
  if (choice.mode === "custom") {
    const message = error ?? validateCron(choice.expression);
    if (message) return <Text style={styles.error}>{message}</Text>;
    const described = describeCron({ type: "cron", expression: choice.expression, timezone });
    return (
      <Text style={styles.hint}>
        {described ?? t("heartbeats.cadence.timezone", { zone: timezone })}
      </Text>
    );
  }
  if (choice.mode === "every") return null;
  return <Text style={styles.hint}>{t("heartbeats.cadence.timezone", { zone: timezone })}</Text>;
}

/** Short weekday names in the app's language, by cron day number. */
function weekdayLabels(language: string): string[] {
  // 2026-10-04 is a Sunday; add the cron day number to it.
  return Array.from({ length: 7 }, (_, day) =>
    new Date(2026, 9, 4 + day).toLocaleDateString(language, { weekday: "short" }),
  );
}

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);
  return {
    stack: { gap: theme.spacing[3] },
    // As wide as its four labels, not the field.
    modes: { alignSelf: "flex-start" as const },
    row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.spacing[2] },
    amount: { width: 72 },
    time: { width: 96 },
    cron: { fontFamily: theme.fontFamily.mono },
    at: { fontSize: theme.fontSize.base, color: theme.colors.foregroundMuted },
    daysTrack: {
      ...geometry.segmentedContainerSm,
      ...geometry.segmentedTrackSm,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[1],
      backgroundColor: theme.colors.surfaceSegmentedTrack,
      borderColor: "transparent",
    },
    quick: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
    hint: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
    error: { fontSize: theme.fontSize.sm, color: theme.colors.palette.red[300] },
  };
});
