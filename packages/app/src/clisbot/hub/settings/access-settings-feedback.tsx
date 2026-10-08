import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { settingsStyles } from "@/styles/settings";

export function QueryFeedback({
  queries,
}: {
  queries: Array<{ isPending: boolean; error: Error | null }>;
}) {
  const { t } = useTranslation();
  if (queries.some((query) => query.isPending)) {
    return <Text style={settingsStyles.rowHint}>{t("hub.access.page.loading")}</Text>;
  }
  const error = queries.find((query) => query.error)?.error;
  return error ? <Alert variant="error" title={error.message} /> : null;
}

export function EmptyRow({ message }: { message: string }) {
  return (
    <View style={settingsStyles.row}>
      <Text style={settingsStyles.rowHint}>{message}</Text>
    </View>
  );
}
