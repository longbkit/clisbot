import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { buildSettingsAddHostRoute } from "@/utils/host-routes";
import { useHubStartStatus } from "./hub-start-status";

export function HubStartHelp({
  host,
  localServerId,
  disabled,
  retry,
}: {
  host: { serverId: string; label: string };
  localServerId: string | null;
  disabled: boolean;
  retry(): void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button size="sm" variant="outline" disabled={disabled} onPress={show}>
        {t("hub.connection.startHelp.action")}
      </Button>
      {open ? (
        <HubStartHelpSheet host={host} localServerId={localServerId} close={close} retry={retry} />
      ) : null}
    </>
  );
}

function HubStartHelpSheet({
  host,
  localServerId,
  close,
  retry,
}: {
  host: { serverId: string; label: string };
  localServerId: string | null;
  close(): void;
  retry(): void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const online = useHostRuntimeIsConnected(host.serverId);
  const status = useHubStartStatus(host.serverId, localServerId);
  let reason: string = status.status;
  if (status.status === "blocked") reason = status.reason;
  if (!online) reason = "offline";
  const title = t("hub.connection.startHelp.title", { host: host.label });
  const description = t(`hub.connection.startHelp.reasons.${reason}`);
  const steps = t(`hub.connection.startHelp.steps.${reason}`);
  const header = useMemo(() => ({ title, subtitle: host.serverId }), [title, host.serverId]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const copy = useCallback(async () => {
    setError(false);
    try {
      await copyToClipboard(`${title}\nHost ID: ${host.serverId}\n\n${description}\n\n${steps}`);
      setCopied(true);
    } catch {
      setError(true);
    }
  }, [title, host.serverId, description, steps]);
  const viewHost = useCallback(() => {
    close();
    router.push(`/settings/hosts/${host.serverId}/host`);
  }, [close, router, host.serverId]);
  const pair = useCallback(() => {
    close();
    router.push(buildSettingsAddHostRoute(Date.now()));
  }, [close, router]);
  const check = useCallback(() => {
    retry();
    close();
  }, [retry, close]);
  return (
    <AdaptiveModalSheet visible onClose={close} header={header} testID="hub-start-help">
      <View style={styles.body}>
        <Text style={styles.reason} selectable>
          {description}
        </Text>
        <Text style={styles.steps} selectable>
          {steps}
        </Text>
        {error ? (
          <Alert variant="error" description={t("hub.connection.startHelp.copyFailed")} />
        ) : null}
        <View style={styles.actions}>
          <Button variant="outline" onPress={copy}>
            {t(copied ? "pairing.device.copied" : "hub.connection.startHelp.copy")}
          </Button>
          <Button variant="outline" onPress={viewHost}>
            {t("hub.connection.inventory.viewHost")}
          </Button>
          {reason === "owner_required" ? (
            <Button variant="default" onPress={pair}>
              {t("hub.connection.startHelp.pair")}
            </Button>
          ) : (
            <Button variant="default" onPress={check}>
              {t("hub.connection.startHelp.check")}
            </Button>
          )}
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[4] },
  reason: { fontSize: theme.fontSize.base, color: theme.colors.foreground, lineHeight: 22 },
  steps: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
