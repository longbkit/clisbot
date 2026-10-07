import { useCallback, useState } from "react";
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
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const commit = useCallback(() => {
    const limit = Number(text.trim());
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CONNECTOR_DAILY_SEND_LIMIT) {
      setError(`Enter a whole number from 1 to ${MAX_CONNECTOR_DAILY_SEND_LIMIT}.`);
      return;
    }
    setError(null);
    if (limit !== value) onChange(limit);
  }, [onChange, text, value]);
  return (
    <SettingsRow
      label="Sends a day"
      hint="Counted across every app, per Project; resets at midnight on the Host."
      error={error ?? undefined}
    >
      <FormTextInput
        accessibilityLabel="Sends a day"
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
