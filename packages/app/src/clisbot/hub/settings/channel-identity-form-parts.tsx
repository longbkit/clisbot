import { Text } from "react-native";
import { Alert } from "@/components/ui/alert";
import type { SelectFieldOption } from "@/components/ui/select-field";
import { settingsStyles } from "@/styles/settings";

export function selectedOptionDisplay(
  options: SelectFieldOption<string>[],
  value: string | null,
): { label: string; description?: string } | null {
  const option = options.find((candidate) => candidate.value === value);
  return option === undefined
    ? null
    : {
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      };
}

export function QueryFeedback({
  queries,
}: {
  queries: Array<{ isPending: boolean; error: Error | null }>;
}) {
  if (queries.some((query) => query.isPending)) {
    return <Text style={settingsStyles.rowHint}>Loading…</Text>;
  }
  const error = queries.find((query) => query.error)?.error;
  return error ? <Alert variant="error" title={error.message} /> : null;
}
