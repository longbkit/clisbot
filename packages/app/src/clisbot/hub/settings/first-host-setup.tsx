import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AddHostModal } from "@/components/add-host-modal";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { buildHostRootRoute } from "@/utils/host-routes";
import { useHubAccount } from "../account-provider";
import { useHostInventory } from "../host-inventory";
import { buildHubSettingsRoute } from "../navigation";

/** Account is the post-sign-in destination when no Host can be opened yet. */
export function FirstHostSetup() {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const inventory = useHostInventory();
  const router = useRouter();
  const [directVisible, setDirectVisible] = useState(false);
  const openManaged = useCallback(() => router.push(buildHubSettingsRoute("hosts")), [router]);
  const openDirect = useCallback(() => setDirectVisible(true), []);
  const closeDirect = useCallback(() => setDirectVisible(false), []);
  const hostAdded = useCallback(
    ({ serverId }: { serverId: string }) => {
      setDirectVisible(false);
      router.push(buildHostRootRoute(serverId));
    },
    [router],
  );

  if (!hub.enabled || !hub.signedIn) return null;
  // A registered/offline Host is still a Host. Do not prompt another enrollment
  // while its connection offer or runtime binding is arriving.
  if (inventory.hosts.length > 0 || (inventory.daemons.data?.daemons.length ?? 0) > 0) return null;
  if (inventory.status === "loading") {
    return (
      <SettingsSection title={t("hub.settings.firstHostSetup.yourHosts")}>
        <Text style={settingsStyles.rowHint}>{t("hub.settings.firstHostSetup.checking")}</Text>
      </SettingsSection>
    );
  }
  if (inventory.status === "error") {
    return (
      <SettingsSection title={t("hub.settings.firstHostSetup.yourHosts")}>
        <Alert
          variant="error"
          title={t("hub.settings.firstHostSetup.loadFailed")}
          description={inventory.error ?? undefined}
        >
          <Button size="sm" variant="outline" onPress={inventory.retry}>
            {t("hub.settings.firstHostSetup.retry")}
          </Button>
        </Alert>
      </SettingsSection>
    );
  }
  const canManage = hub.signedIn.capabilities.manageResources;
  return (
    <>
      <SettingsSection title={t("hub.settings.firstHostSetup.title")}>
        <Text style={settingsStyles.rowHint}>{t("hub.settings.firstHostSetup.intro")}</Text>
        <View style={settingsStyles.card}>
          <View style={styles.option}>
            <Text style={settingsStyles.rowTitle}>
              {t("hub.settings.firstHostSetup.managedTitle")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {canManage
                ? t("hub.settings.firstHostSetup.managedCanManage", {
                    organization: hub.signedIn.organization.name,
                  })
                : t("hub.settings.firstHostSetup.managedShared")}
            </Text>
            <View style={styles.actions}>
              <Button onPress={openManaged}>
                {canManage
                  ? t("hub.settings.firstHostSetup.addViaHub")
                  : t("hub.settings.firstHostSetup.viewShared")}
              </Button>
            </View>
          </View>
        </View>
        <View style={settingsStyles.card}>
          <View style={styles.option}>
            <Text style={settingsStyles.rowTitle}>
              {t("hub.settings.firstHostSetup.directTitle")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("hub.settings.firstHostSetup.directDescription")}
            </Text>
            <View style={styles.actions}>
              <Button variant="outline" onPress={openDirect}>
                {t("hub.settings.firstHostSetup.connectDirectly")}
              </Button>
            </View>
          </View>
        </View>
      </SettingsSection>
      <AddHostModal
        visible={directVisible}
        onClose={closeDirect}
        onCancel={closeDirect}
        onSaved={hostAdded}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  option: { padding: theme.spacing[4], gap: theme.spacing[2] },
  actions: { alignItems: "flex-start", marginTop: theme.spacing[2] },
}));
