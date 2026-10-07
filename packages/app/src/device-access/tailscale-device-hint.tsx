import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { openExternalUrl } from "@/utils/open-external-url";
import { TAILSCALE_DOWNLOAD_URL } from "./host-tailscale";

export function offersTailscaleRoute(host: HostProfile): boolean {
  return host.connections.some(
    (connection) =>
      connection.type === "directTcp" && /\.ts\.net(?::\d+)?$/i.test(connection.endpoint),
  );
}

/** The Host offers a Tailscale route but this device reached it through relay, so
 * Tailscale is off here. Turning it on is enough; the app switches routes itself. */
export function TailscaleDeviceHint({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const snapshot = useHostRuntimeSnapshot(host.serverId);
  if (snapshot?.activeConnection?.type !== "relay" || !offersTailscaleRoute(host)) return null;
  return (
    <View style={styles.hint}>
      <Alert size="sm" variant="info" description={t("settings.host.connections.tailscaleHint")}>
        <Button variant="outline" size="sm" onPress={openTailscaleDownload}>
          {t("settings.host.connections.getTailscale")}
        </Button>
      </Alert>
    </View>
  );
}

function openTailscaleDownload() {
  void openExternalUrl(TAILSCALE_DOWNLOAD_URL);
}

const styles = StyleSheet.create((theme) => ({
  hint: {
    marginBottom: theme.spacing[3],
  },
}));
