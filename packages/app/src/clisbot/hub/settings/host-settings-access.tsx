import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { useHostInventory } from "../host-inventory";

/** Keep a stale Host URL from mounting settings for a Host hidden by the inventory. */
export function HostSettingsAccess({
  serverId,
  children,
}: {
  serverId: string | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { hosts, status, retry } = useHostInventory();
  if (serverId === null || hosts.some((host) => host.serverId === serverId)) return children;
  const messages = {
    loading: t("hub.settings.hostAccess.loading"),
    error: t("hub.settings.hostAccess.error"),
    ready: t("hub.settings.hostAccess.ready"),
  };
  return (
    <View>
      <Text style={settingsStyles.rowHint}>{messages[status]}</Text>
      {status === "error" ? (
        <Button onPress={retry}>{t("hub.settings.hostAccess.retry")}</Button>
      ) : null}
    </View>
  );
}
