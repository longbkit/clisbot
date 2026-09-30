import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
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
      <SettingsSection title="Your Hosts">
        <Text style={settingsStyles.rowHint}>Checking your Hosts…</Text>
      </SettingsSection>
    );
  }
  if (inventory.status === "error") {
    return (
      <SettingsSection title="Your Hosts">
        <Alert
          variant="error"
          title="Could not load your Hosts"
          description={inventory.error ?? undefined}
        >
          <Button size="sm" variant="outline" onPress={inventory.retry}>
            Retry
          </Button>
        </Alert>
      </SettingsSection>
    );
  }
  const canManage = hub.signedIn.capabilities.manageResources;
  return (
    <>
      <SettingsSection title="Add your first Host">
        <Text style={settingsStyles.rowHint}>
          A Host is a computer running Clisbot and your AI agents. Choose how to connect it to start
          working.
        </Text>
        <View style={settingsStyles.card}>
          <View style={styles.option}>
            <Text style={settingsStyles.rowTitle}>Managed Host</Text>
            <Text style={settingsStyles.rowHint}>
              {canManage
                ? `Add a computer to ${hub.signedIn.organization.name}. Manage who can use its Projects and agents through Hub.`
                : "Use a Host shared by your organization. Ask an owner or admin to add one or grant you access."}
            </Text>
            <View style={styles.actions}>
              <Button onPress={openManaged}>
                {canManage ? "Add via Hub" : "View shared Hosts"}
              </Button>
            </View>
          </View>
        </View>
        <View style={settingsStyles.card}>
          <View style={styles.option}>
            <Text style={settingsStyles.rowTitle}>Direct Host</Text>
            <Text style={settingsStyles.rowHint}>
              Connect to a computer by address and save it on this device. Have its address and
              daemon password ready, if required.
            </Text>
            <View style={styles.actions}>
              <Button variant="outline" onPress={openDirect}>
                Connect directly
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
