import { useCallback, useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "./account-provider";
import { HubSettingsContent } from "./settings/screen";
import { HubSettingsDetailScrollProvider } from "./settings/detail-scroll";

export function AutomationsScreen() {
  const hub = useHubAccount();
  const router = useRouter();
  const scroll = useRef<ScrollView>(null);
  const scrollToTop = useCallback(() => scroll.current?.scrollTo({ y: 0, animated: false }), []);
  const openAccount = useCallback(() => router.push("/settings/hub/account"), [router]);
  return (
    <View style={styles.container}>
      <MenuHeader title="Automations" />
      <ScrollView ref={scroll} contentContainerStyle={styles.content}>
        <View style={styles.detail}>
          {!hub.enabled ? (
            <Text style={settingsStyles.rowHint}>Hub is not enabled in this build.</Text>
          ) : null}
          {hub.enabled && !hub.loading && !hub.signedIn ? (
            <Button size="sm" onPress={openAccount}>
              Sign in to Hub
            </Button>
          ) : null}
          <HubSettingsDetailScrollProvider onNavigate={scrollToTop}>
            <HubSettingsContent section="automations" />
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
