import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionHeader } from "./section-header";

/** Tasks is visible but in development (brief C14): no data, no actions. */
export function TasksScreen() {
  const { t } = useTranslation();
  return (
    <View style={styles.page} testID="tasks-screen">
      <SectionHeader title={t("navigation.sections.tasks")} />
      <View style={styles.body}>
        <StatusBadge label={t("navigation.preview")} variant="warning" />
        <Text style={styles.title}>{t("navigation.tasksPlaceholder.title")}</Text>
        <Text style={styles.text}>{t("navigation.tasksPlaceholder.body")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, backgroundColor: theme.colors.surface0 },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[6],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base, textAlign: "center" },
}));
