import { Import, Plus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useSidebarModel } from "./sidebar-model";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

/**
 * The two things the sidebar's workspace list says when it has no rows.
 *
 * Both are bodies, not screens: a list mode renders one where its groups would go, inside its own
 * scroll and below the section header it already owns. The header carries the display menu's
 * trigger, and an empty state that replaces the list rather than its body takes the header with
 * it — which is how filtering the last row away used to close the menu you were filtering from.
 */
export function SidebarFilterEmptyState() {
  const { t } = useTranslation();
  const clearAllFilters = useSidebarViewStore((state) => state.clearAllFilters);

  return (
    <View style={styles.container} testID="sidebar-filter-empty-state">
      <Text style={styles.title}>{t("sidebar.filterEmpty.title")}</Text>
      <Text style={styles.description}>{t("sidebar.filterEmpty.description")}</Text>
      <Button variant="ghost" size="sm" onPress={clearAllFilters}>
        {t("sidebar.filterEmpty.clear")}
      </Button>
    </View>
  );
}

export function SidebarMetadataNotice() {
  const { metadataRecoveryNotice } = useSidebarModel();
  if (!metadataRecoveryNotice) return null;
  return (
    <Text
      style={styles.description}
      accessibilityLiveRegion="polite"
      testID="sidebar-metadata-notice"
    >
      {metadataRecoveryNotice}
    </Text>
  );
}

export function SidebarProjectEmptyState({
  onAddProject,
  onImportSession,
}: {
  onAddProject?: () => void;
  onImportSession?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.container} testID="sidebar-project-empty-state">
      <Text style={styles.title}>{t("sidebar.project.empty.title")}</Text>
      <Text style={styles.description}>{t("sidebar.project.empty.description")}</Text>
      <Button variant="ghost" size="sm" leftIcon={Plus} onPress={onAddProject}>
        {t("sidebar.actions.addProject")}
      </Button>
      <Button variant="ghost" size="sm" leftIcon={Import} onPress={onImportSession}>
        {t("importSession.title")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    marginHorizontal: theme.spacing[2],
    marginTop: theme.spacing[4],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    gap: theme.spacing[3],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
