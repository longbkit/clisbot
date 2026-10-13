import { useCallback } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useFetchQuery } from "@/data/query";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { settingsStyles } from "@/styles/settings";

/** Explicit Host selection owns every operation; a phone never launches a browser-local service. */
export function LocalWebSettings({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const localId = useLocalDaemonServerId();
  const supported = client?.getLastServerInfoMessage()?.features?.localWeb === true;
  const query = useFetchQuery({
    queryKey: ["local-web", serverId],
    queryFn: () => client!.controlLocalWeb("status"),
    enabled: supported,
    dataShape: "value",
    staleTimeMs: 15_000,
    retry: 1,
  });
  const change = useMutation({
    mutationFn: (action: "start" | "stop") => client!.controlLocalWeb(action),
    onSuccess: () => {
      void query.refetch();
    },
  });
  const status = query.data;
  const open = status?.running
    ? (status.tailscaleUrl ?? (serverId === localId ? status.origin : null))
    : null;
  const toggle = useCallback(
    () => change.mutate(status?.enabled ? "stop" : "start"),
    [change, status?.enabled],
  );
  return (
    <View>
      <Text style={settingsStyles.rowHint}>{t("hub.connection.localWeb.title")}</Text>
      {!supported ? (
        <Text style={settingsStyles.rowHint}>{t("pairing.device.updateRequired")}</Text>
      ) : null}
      {status?.running && status.origin ? (
        <Text style={settingsStyles.rowHint}>{status.origin}</Text>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        disabled={!supported || change.isPending}
        onPress={toggle}
      >
        {t(status?.enabled ? "hub.connection.localWeb.disable" : "hub.connection.localWeb.enable")}
      </Button>
      {open ? <ExternalLink href={open}>{t("hub.connection.localWeb.open")}</ExternalLink> : null}
      {query.error || change.error ? (
        <Text style={settingsStyles.rowHint}>{t("hub.connection.localWeb.failed")}</Text>
      ) : null}
    </View>
  );
}
