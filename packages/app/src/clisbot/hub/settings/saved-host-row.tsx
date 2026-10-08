import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { HostProfile } from "@/types/host-connection";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { hubHostStatusPresentation } from "../host-onboarding";

/** A user-saved Host has local settings, without organization management actions. */
export function SavedHostRow({
  host,
  status,
  bordered,
}: {
  host: HostProfile;
  status: HostRuntimeConnectionStatus | undefined;
  bordered: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const open = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(host.serverId, "host"));
  }, [host.serverId, router]);
  const badge = hubHostStatusPresentation(
    status === "online" || status === "offline" || status === "error" ? status : "connecting",
  );
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{host.label}</Text>
        <Text style={settingsStyles.rowHint} selectable>
          {t("hub.settings.savedHost.hostId", { id: host.serverId })}
        </Text>
      </View>
      <StatusBadge label={badge.label} variant={badge.variant} />
      <Button size="sm" variant="outline" onPress={open}>
        {t("hub.settings.savedHost.openHost")}
      </Button>
    </View>
  );
}
