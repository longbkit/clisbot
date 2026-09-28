import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SelectField } from "@/components/ui/select-field";

const CHOICES = [1, 2, 3, 5, 8, 10, 15, 20] as const;

function roundsLabel(rounds: number): string {
  return rounds === 1 ? "1 round" : `${rounds} rounds`;
}

/**
 * The guard rail on a group discussion (docs/features/bots-and-chats/plans/group-discussion.md):
 * the most rounds the daemon runs before stopping it. Bots stop earlier when they are done.
 */
export function RoundsField({
  value,
  onChange,
  disabled,
  size,
}: {
  value: number;
  onChange: (rounds: number) => void;
  disabled: boolean;
  size: "sm" | "md";
}) {
  const options = useMemo(() => {
    const values = CHOICES.includes(value as (typeof CHOICES)[number])
      ? [...CHOICES]
      : [...CHOICES, value].toSorted((left, right) => left - right);
    return values.map((rounds) => ({
      id: String(rounds),
      value: String(rounds),
      label: roundsLabel(rounds),
    }));
  }, [value]);
  const select = useCallback((next: string) => onChange(Number(next)), [onChange]);
  const selected = useMemo(() => ({ label: roundsLabel(value) }), [value]);
  return (
    <View style={styles.field}>
      <SelectField
        label="Discussion limit"
        value={String(value)}
        selectedDisplay={selected}
        options={options}
        onChange={select}
        disabled={disabled}
        placeholder="Choose a limit"
        emptyText="No limits"
        size={size}
      />
      <Text style={styles.hint}>
        The most rounds bots take before the discussion stops. They stop earlier once the question
        is settled.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: { gap: theme.spacing[2] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
