import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { StatusBadge } from "@/components/ui/status-badge";
import { MenuHeader } from "@/components/headers/menu-header";

/**
 * A section that is visible but in development (brief C14: Tasks; Design, Owner 2026-10-26): its
 * place in the navigation and a placeholder page, no data, no actions.
 */
export function PreviewSectionScreen({ section }: { section: "tasks" | "design" }) {
  const { t } = useTranslation();
  return (
    <View style={styles.page} testID={`${section}-screen`}>
      {/* MenuHeader gives a phone its Back to More; the rail is the desktop's way out. */}
      <MenuHeader title={t(`navigation.sections.${section}`)} />
      <View style={styles.body}>
        <StatusBadge label={t("navigation.preview")} variant="warning" />
        <Text style={styles.title}>{t(`navigation.${section}Placeholder.title`)}</Text>
        <Text style={styles.text}>{t(`navigation.${section}Placeholder.body`)}</Text>
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
