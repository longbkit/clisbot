import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/ui/select-field";

const CHOICES = [1, 2, 3, 5, 8, 10, 15, 20] as const;

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
  const { t } = useTranslation();
  const options = useMemo(() => {
    const values = CHOICES.includes(value as (typeof CHOICES)[number])
      ? [...CHOICES]
      : [...CHOICES, value].toSorted((left, right) => left - right);
    return values.map((rounds) => ({
      id: String(rounds),
      value: String(rounds),
      label: t("bots.chat.rounds.count", { count: rounds }),
    }));
  }, [value, t]);
  const select = useCallback((next: string) => onChange(Number(next)), [onChange]);
  const selected = useMemo(
    () => ({ label: t("bots.chat.rounds.count", { count: value }) }),
    [value, t],
  );
  return (
    <View style={styles.field}>
      <SelectField
        label={t("bots.chat.rounds.label")}
        value={String(value)}
        selectedDisplay={selected}
        options={options}
        onChange={select}
        disabled={disabled}
        placeholder={t("bots.chat.rounds.placeholder")}
        emptyText={t("bots.chat.rounds.empty")}
        size={size}
      />
      <Text style={styles.hint}>{t("bots.chat.rounds.hint")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: { gap: theme.spacing[2] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
