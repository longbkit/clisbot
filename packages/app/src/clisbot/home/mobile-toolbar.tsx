import { builtinSidebarNavLabelKey } from "@/sidebar-nav/model";
import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { SidebarFooter } from "@/components/sidebar/sidebar-footer";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useImportSession } from "@/hooks/use-import-session";
import { openHostOverview } from "@/navigation/settings-navigation";
import { usePanelStore } from "@/stores/panel-store";
import { buildSettingsAddHostRoute, buildSettingsRoute } from "@/utils/host-routes";

/** The existing sidebar actions and preferences, shared by both compact tab pages. */
export function MobileToolbar() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const insetStyle = useMemo(() => ({ paddingTop: insets.top }), [insets.top]);
  const openProject = useOpenAddProject();
  const { open: importSession, sheet } = useImportSession();
  const addProject = useCallback(() => {
    void openProject();
  }, [openProject]);
  const settings = useCallback(() => {
    usePanelStore.getState().showMobileAgent();
    router.push(buildSettingsRoute());
  }, []);
  const addHost = useCallback(() => {
    usePanelStore.getState().showMobileAgent();
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, []);
  const hostSettings = useCallback((serverId: string) => {
    usePanelStore.getState().showMobileAgent();
    openHostOverview(serverId);
  }, []);
  const labels = useMemo(
    () => ({
      addProject: t("sidebar.actions.addProject"),
      hosts: t("sidebar.actions.hosts"),
      importSession: t("importSession.title"),
      settings: t("sidebar.actions.settings"),
      searchHosts: t("sidebar.host.searchPlaceholder"),
      usage: t(builtinSidebarNavLabelKey("usage")),
    }),
    [t],
  );
  return (
    <View style={[styles.toolbar, insetStyle]} testID="mobile-toolbar">
      <SidebarFooter
        top
        handleOpenProject={addProject}
        handleImportSession={importSession}
        handleSettings={settings}
        handleAddHost={addHost}
        handleOpenHostSettings={hostSettings}
        labels={labels}
      />
      {sheet}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  toolbar: { backgroundColor: theme.colors.surfaceSidebar },
}));
