import { useCallback, useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "./account-provider";
import { HubSettingsContent } from "./settings/screen";
import { HubSettingsDetailScrollProvider } from "./settings/detail-scroll";

export function AutomationsScreen({
  embedded = false,
  initialCreate = false,
}: { embedded?: boolean; initialCreate?: boolean } = {}) {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const scroll = useRef<ScrollView>(null);
  const scrollToTop = useCallback(() => scroll.current?.scrollTo({ y: 0, animated: false }), []);
  return (
    <View style={styles.container}>
      {!embedded ? <MenuHeader title={t("hub.automations.title")} /> : null}
      <ScrollView ref={scroll} contentContainerStyle={styles.content}>
        <View style={styles.detail}>
          {!hub.enabled ? (
            <Text style={settingsStyles.rowHint}>{t("hub.automations.hubDisabled")}</Text>
          ) : null}
          <HubSettingsDetailScrollProvider onNavigate={scrollToTop}>
            <HubSettingsContent section="automations" initialAutomationCreate={initialCreate} />
          </HubSettingsDetailScrollProvider>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { padding: theme.spacing[4], alignItems: "center" },
  detail: { width: "100%", maxWidth: 720 },
}));
