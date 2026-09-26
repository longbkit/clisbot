import { useRouter } from "expo-router";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useHostInventory } from "@/clisbot/hub/host-inventory";
import { useHostWaitTimeout } from "@/hosts/use-host-wait-timeout";
import { Button } from "@/components/ui/button";
import { recordHostDiagnostic } from "@/runtime/host-diagnostics";
import { useHosts } from "@/runtime/host-runtime";
import { buildOpenProjectRoute, buildWelcomeRoute } from "@/utils/host-routes";

/**
 * Shown in place of a Host route outside the current inventory. It never navigates on its own:
 * leaving is the reader's choice, and when the Host is registered again the route renders it where
 * the reader already is.
 */
export function HostUnavailableScreen({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const savedHost = useHosts().find((host) => host.serverId === serverId);
  const { hosts, daemons, status, retry } = useHostInventory();
  const daemon = daemons.isPlaceholderData
    ? undefined
    : daemons.data?.daemons.find(
        (entry) =>
          entry.connectionOffer?.serverId === serverId ||
          entry.id === savedHost?.management?.daemonId,
      );
  const listedByHub = daemon !== undefined;
  const waiting =
    status === "loading" || (status === "ready" && listedByHub && daemon.presence !== "offline");
  const { timedOut, reset } = useHostWaitTimeout(waiting, serverId);
  let message: "error" | "timeout" | "loading" | "offline" | "reconnecting" | "denied" | null =
    null;
  if (status === "error") message = "error";
  else if (timedOut) message = "timeout";
  else if (status === "loading") message = "loading";
  else if (daemon?.presence === "offline") message = "offline";
  else if (listedByHub) message = "reconnecting";
  else if (savedHost?.management) message = "denied";
  const hasOtherHosts = hosts.some((host) => host.serverId !== serverId);
  const openOtherHost = useCallback(() => router.push(buildOpenProjectRoute()), [router]);
  const addHost = useCallback(() => router.push(buildWelcomeRoute({ stay: true })), [router]);
  const retryHost = useCallback(() => {
    reset();
    retry();
    // Reconciliation owns registering Hosts after access has been refreshed.
  }, [reset, retry]);

  useEffect(() => {
    recordHostDiagnostic("host-route-unavailable", {
      serverId,
      listedByHub: listedByHub ?? null,
      registeredHosts: hosts.map((host) => host.serverId),
    });
    // Record when the state changes, not on every registry update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, listedByHub]);

  return (
    <View style={styles.container} testID="host-unavailable">
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>
            {message ? t(`hostUnavailable.${message}Title`) : t("hostUnavailable.title")}
          </Text>
          <Text style={styles.body}>
            {message ? t(`hostUnavailable.${message}Body`) : t("hostUnavailable.body")}
          </Text>
        </View>
        <View style={styles.actions}>
          {!waiting || timedOut ? (
            <Button onPress={retryHost} testID="host-unavailable-retry">
              {t("common.actions.retry")}
            </Button>
          ) : null}
          {hasOtherHosts ? (
            <Button
              variant="secondary"
              onPress={openOtherHost}
              testID="host-unavailable-open-other"
            >
              {t("hostUnavailable.openOtherHost")}
            </Button>
          ) : null}
          <Button variant="secondary" onPress={addHost} testID="host-unavailable-add-host">
            {t("hostUnavailable.addHost")}
          </Button>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    flex: 1,
    alignSelf: "center",
    width: "100%",
    maxWidth: 420,
    justifyContent: "center",
    gap: theme.spacing[6],
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[8],
  },
  header: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  body: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
    textAlign: "center",
  },
  actions: {
    gap: theme.spacing[2],
  },
}));
