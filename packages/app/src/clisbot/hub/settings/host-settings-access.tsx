import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useConfirmRemoveHost } from "@/hosts/use-confirm-remove-host";
import { useHosts } from "@/runtime/host-runtime";
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
  const saved = useHosts().find((host) => host.serverId === serverId);
  if (serverId === null || hosts.some((host) => host.serverId === serverId)) return children;
  if (status === "loading")
    return <Text style={settingsStyles.rowHint}>{t("hub.settings.hostAccess.loading")}</Text>;
  const reason =
    status === "error"
      ? t("hub.settings.hostAccess.hubUnavailable")
      : t("hub.settings.hostAccess.ready");
  if (!saved)
    return (
      <View style={styles.block}>
        <Text style={settingsStyles.rowHint}>{reason}</Text>
        {status === "error" ? <RetryButton retry={retry} /> : null}
      </View>
    );
  return (
    <HiddenHost
      serverId={serverId}
      label={saved.label}
      reason={reason}
      retry={status === "error" ? retry : null}
    />
  );
}

/** A saved Host this account cannot list: say which one and why, then retry or forget it. */
function HiddenHost(props: {
  serverId: string;
  label: string;
  reason: string;
  retry: (() => void) | null;
}) {
  const { t } = useTranslation();
  const isLocalDaemon = useIsLocalDaemon(props.serverId);
  const { remove, removing } = useConfirmRemoveHost(props.serverId, props.label);
  return (
    <View style={[settingsStyles.card, styles.card]}>
      <Text style={settingsStyles.rowTitle}>{props.label}</Text>
      <Text style={settingsStyles.rowHint} selectable>
        {t("hub.settings.hostAccess.hostId", { id: props.serverId })}
      </Text>
      <Text style={settingsStyles.rowHint}>{props.reason}</Text>
      <View style={styles.actions}>
        {props.retry ? <RetryButton retry={props.retry} /> : null}
        {isLocalDaemon ? null : (
          <Button variant="outline" size="sm" onPress={remove} disabled={removing}>
            {t("hub.settings.hostAccess.remove")}
          </Button>
        )}
      </View>
    </View>
  );
}

function RetryButton({ retry }: { retry: () => void }) {
  const { t } = useTranslation();
  return (
    <Button variant="outline" size="sm" onPress={retry}>
      {t("hub.settings.hostAccess.retry")}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  block: { gap: theme.spacing[2], alignItems: "flex-start" },
  card: { padding: theme.spacing[4], gap: theme.spacing[1] },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
}));
