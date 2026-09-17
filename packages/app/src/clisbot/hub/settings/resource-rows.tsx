import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { settingsStyles } from "@/styles/settings";

type ResourceQuery = UseQueryResult<unknown, Error>;

/** Loading or error state of one Hub resource query; nothing once it has data. */
export function ResourceFeedback({ query }: { query: ResourceQuery }) {
  return <ResourceFeedbackGroup queries={[query]} />;
}

/** One loading line or the first error across several Hub resource queries. */
export function ResourceFeedbackGroup({ queries }: { queries: ResourceQuery[] }) {
  if (queries.some(({ isPending }) => isPending)) {
    return <Text style={settingsStyles.rowHint}>Loading…</Text>;
  }
  const error = queries.find((query) => query.error)?.error;
  return error ? <Alert variant="error" title={error.message} /> : null;
}

export function InfoRow({
  title,
  hint,
  bordered = false,
}: {
  title: string;
  hint: string;
  bordered?: boolean;
}) {
  const style = useMemo(
    () => [settingsStyles.row, bordered ? settingsStyles.rowBorder : null],
    [bordered],
  );
  return (
    <View style={style}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
    </View>
  );
}

export function EmptyRow({ message }: { message: string }) {
  return (
    <View style={styles.empty}>
      <Text style={settingsStyles.rowHint}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  empty: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[6],
    alignItems: "center",
  },
}));
