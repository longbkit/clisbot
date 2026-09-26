import type { ReactNode } from "react";
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
  const { hosts, status, retry } = useHostInventory();
  if (serverId === null || hosts.some((host) => host.serverId === serverId)) return children;
  const messages = {
    loading: "Loading Hosts...",
    error: "Hosts unavailable. Try loading your Hosts again.",
    ready: "This Host is not available to your current account. Choose another Host.",
  };
  return (
    <View>
      <Text style={settingsStyles.rowHint}>{messages[status]}</Text>
      {status === "error" ? <Button onPress={retry}>Retry</Button> : null}
    </View>
  );
}
