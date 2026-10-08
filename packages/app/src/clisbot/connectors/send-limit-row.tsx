import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { MAX_CONNECTOR_DAILY_SEND_LIMIT } from "@clisbot/protocol/connectors/types";
import { SettingsRow } from "@/components/settings";
import { FormTextInput } from "@/components/ui/form-field";
import { StyleSheet } from "react-native-unistyles";

/** How many sends a Project's agents may make a day without asking; saved when the field loses focus. */
export function SendLimitRow({
  value,
  onChange,
}: {
  value: number;
  onChange(limit: number): void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const commit = useCallback(() => {
    const limit = Number(text.trim());
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CONNECTOR_DAILY_SEND_LIMIT) {
      setError(t("connectors.screen.sending.limitError", { max: MAX_CONNECTOR_DAILY_SEND_LIMIT }));
      return;
    }
    setError(null);
    if (limit !== value) onChange(limit);
  }, [onChange, t, text, value]);
  return (
    <SettingsRow
      label={t("connectors.screen.sending.limit")}
      hint={t("connectors.screen.sending.limitHint")}
      error={error ?? undefined}
    >
      <FormTextInput
        accessibilityLabel={t("connectors.screen.sending.limit")}
        initialValue={String(value)}
        keyboardType="number-pad"
        size="sm"
        onChangeText={setText}
        onBlur={commit}
        onSubmitEditing={commit}
        style={styles.input}
      />
    </SettingsRow>
  );
}

const styles = StyleSheet.create({ input: { width: 80 } });
