import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { ScheduleCadence } from "@clisbot/protocol/schedule/types";
import { runsMoreThanDaily } from "@clisbot/protocol/schedule/run-limit";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";

/**
 * Max runs, required once the cadence repeats within the day so a schedule can never run without
 * end (docs/audits/2026-10-06-conversation-schedules.md). Callers keep Save off while it is empty.
 */
export function MaxRunsField({
  cadence,
  value,
  onChange,
  size,
  testID,
}: {
  cadence: ScheduleCadence;
  value: string;
  onChange: (value: string) => void;
  size: FieldControlSize;
  testID: string;
}): ReactElement {
  const { t } = useTranslation();
  const required = runsMoreThanDaily(cadence);
  return (
    <Field
      label={t("heartbeats.detail.maxRuns")}
      hint={required ? t("heartbeats.detail.maxRunsRequiredHint") : undefined}
      testID={`${testID}-field`}
    >
      <FormTextInput
        size={size}
        testID={testID}
        accessibilityLabel={t("heartbeats.detail.maxRuns")}
        initialValue={value}
        onChangeText={onChange}
        placeholder={
          required ? t("heartbeats.detail.maxRunsRequired") : t("heartbeats.detail.unlimited")
        }
        keyboardType="number-pad"
      />
    </Field>
  );
}
