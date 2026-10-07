import { useCallback } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { Network, RotateCw, ShieldCheck } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { useFetchQuery } from "@/data/query";
import { daemonPairingOfferQueryKey } from "@/data/daemon-pairing";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient, useHostRuntimeSnapshot, useHosts } from "@/runtime/host-runtime";
import { useHubProfiles } from "@/device-access/hub-profiles";
import { appDevicePairingOffer } from "@/device-access/pairing-offer";
import { PairingLinkPanel } from "@/device-access/pairing-link-panel";
import { tailscaleRowModel, useHostTailscale } from "@/device-access/host-tailscale";
import { TailscaleRouteRow } from "@/device-access/tailscale-route-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";

const RELAY_DOCS_URL = "https://clisbot.com/docs/security";
const FLEX_ONE_STYLE = { flex: 1 } as const;
const ThemedShieldCheck = withUnistyles(ShieldCheck);
const ThemedNetwork = withUnistyles(Network);
const accentBrightColorMapping = (theme: Theme) => ({ color: theme.colors.accentBright });

export interface PairDeviceSectionProps {
  serverId: string;
  onClose: () => void;
}

export function PairDeviceSection({ serverId, onClose }: PairDeviceSectionProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const hosts = useHosts();
  const hubProfiles = useHubProfiles();
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const isConnected = runtimeSnapshot?.connectionStatus === "online";
  const isDisconnected =
    runtimeSnapshot?.connectionStatus === "offline" ||
    runtimeSnapshot?.connectionStatus === "error";
  const { patchConfig } = useDaemonConfig(serverId);
  const serverFeatures = client?.getLastServerInfoMessage()?.features;
  const supportsPairingRpc = serverFeatures?.daemonStatusRpc === true;
  const canConfigureRelay = supportsPairingRpc && serverFeatures?.relayConfig === true;

  const pairingQuery = useFetchQuery({
    queryKey: daemonPairingOfferQueryKey(serverId),
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return appDevicePairingOffer(
        client,
        hubProfiles.profiles,
        hosts.find((host) => host.serverId === serverId)?.management?.hubOrigin,
      );
    },
    enabled: supportsPairingRpc && Boolean(client && isConnected),
    dataShape: "value",
    staleTimeMs: 5 * 60 * 1000,
    retry: 1,
  });

  const enableRelay = useMutation({
    mutationFn: async () => {
      if (client?.getLastServerInfoMessage()?.features?.relayConfig !== true) {
        throw new Error(t("pairing.device.updateRequired"));
      }
      const config = await patchConfig({ relay: { enabled: true } });
      if (!config) throw new Error(t("workspace.terminal.hostDisconnected"));
      return pairingQuery.refetch();
    },
  });

  const handleRetry = useCallback(() => {
    void pairingQuery.refetch();
  }, [pairingQuery]);
  const handleEnableRelay = useCallback(() => {
    enableRelay.mutate();
  }, [enableRelay]);

  const tailscale = useHostTailscale(serverId);

  return (
    <View testID="pair-device-content" style={styles.content}>
      {tailscale.supported && !isDisconnected ? (
        <HostRoutes
          tailscale={tailscale}
          relayEnabled={pairingQuery.data?.relayEnabled}
          canConfigureRelay={canConfigureRelay}
          enablePending={enableRelay.isPending}
          enableError={enableRelay.error}
          onEnableRelay={handleEnableRelay}
        />
      ) : null}
      <PairDeviceBody
        routesShown={tailscale.supported}
        isPending={supportsPairingRpc && pairingQuery.isPending}
        isDisconnected={isDisconnected}
        error={pairingQuery.error}
        offer={pairingQuery.data}
        canConfigureRelay={canConfigureRelay}
        enablePending={enableRelay.isPending}
        enableError={enableRelay.error}
        onRetry={handleRetry}
        onEnableRelay={handleEnableRelay}
        onClose={onClose}
      />
    </View>
  );
}

interface PairDeviceBodyProps {
  /** "Ways to connect" is on screen, so it replaces the relay-only consent. */
  routesShown: boolean;
  isPending: boolean;
  isDisconnected: boolean;
  error: Error | null;
  offer: { relayEnabled: boolean; url: string } | undefined;
  canConfigureRelay: boolean;
  enablePending: boolean;
  enableError: Error | null;
  onRetry: () => void;
  onEnableRelay: () => void;
  onClose: () => void;
}

function PairDeviceBody(props: PairDeviceBodyProps) {
  const { t } = useTranslation();
  if (props.isDisconnected) {
    return (
      <OfferLoadError message={t("workspace.terminal.hostDisconnected")} onRetry={props.onRetry} />
    );
  }
  if (props.isPending) {
    return <Text style={styles.stateLine}>{t("pairing.device.loadingOffer")}</Text>;
  }
  if (props.error) {
    return <OfferLoadError message={props.error.message} onRetry={props.onRetry} />;
  }
  if (!props.offer?.url && !props.offer?.relayEnabled) {
    if (props.routesShown)
      return <Text style={styles.stateLine}>{t("pairing.routes.noRoute")}</Text>;
    return <RelayConsent {...props} />;
  }
  if (!props.offer?.url) {
    return <Text style={styles.stateLine}>{t("pairing.device.unavailable")}</Text>;
  }
  return <PairingLinkPanel url={props.offer.url} hint={t("pairing.device.hint")} />;
}

function OfferLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert size="sm" variant="error" description={message}>
      <Button variant="outline" size="sm" leftIcon={RotateCw} onPress={onRetry}>
        {t("pairing.device.retry")}
      </Button>
    </Alert>
  );
}

function RelayConsent(props: PairDeviceBodyProps) {
  const { t } = useTranslation();
  let enableButtonLabel = t("pairing.device.enableRelay");
  if (props.enablePending) {
    enableButtonLabel = t("pairing.device.enablingRelay");
  } else if (props.enableError) {
    enableButtonLabel = t("pairing.device.retry");
  }
  return (
    <View style={styles.consent}>
      <View style={styles.hero}>
        <RelayHeroBadge />
        <Text style={styles.consentTitle}>{t("pairing.device.enableTitle")}</Text>
        <Text style={styles.consentDescription}>{t("pairing.device.enableDescription")}</Text>
        <ExternalLink
          href={RELAY_DOCS_URL}
          label={t("pairing.device.relayDocs")}
          accessibilityLabel={t("pairing.device.relayDocsAccessibility")}
        />
      </View>
      {props.enableError ? (
        <Alert size="sm" variant="error" description={props.enableError.message} />
      ) : null}
      {!props.canConfigureRelay ? (
        <Alert size="sm" variant="warning" description={t("pairing.device.updateRequired")} />
      ) : null}
      <View style={styles.actions}>
        <Button variant="secondary" style={FLEX_ONE_STYLE} onPress={props.onClose}>
          {t("pairing.device.notNow")}
        </Button>
        {props.canConfigureRelay ? (
          <Button
            variant="default"
            style={FLEX_ONE_STYLE}
            loading={props.enablePending}
            onPress={props.onEnableRelay}
          >
            {enableButtonLabel}
          </Button>
        ) : null}
      </View>
      <View style={styles.directRow}>
        <ThemedNetwork size={14} style={styles.directIcon} />
        <Text style={styles.directHint}>{t("pairing.device.directConnectionHint")}</Text>
      </View>
    </View>
  );
}

function RelayHeroBadge() {
  return (
    <View style={styles.heroBadge}>
      <ThemedShieldCheck size={20} uniProps={accentBrightColorMapping} />
    </View>
  );
}

interface HostRoutesProps {
  tailscale: ReturnType<typeof useHostTailscale>;
  relayEnabled: boolean | undefined;
  canConfigureRelay: boolean;
  enablePending: boolean;
  enableError: Error | null;
  onEnableRelay(): void;
}

function HostRoutes(props: HostRoutesProps) {
  const { t } = useTranslation();
  const { query, setUp } = props.tailscale;
  const model = tailscaleRowModel({
    tailscale: query.data,
    settingUp: setUp.isPending,
    failed: query.isError,
  });
  const { mutate } = setUp;
  const { refetch } = query;
  const handleSetUp = useCallback(() => mutate(), [mutate]);
  const handleRetry = useCallback(() => void refetch(), [refetch]);
  return (
    <View style={settingsStyles.card}>
      <TailscaleRouteRow
        model={model}
        description={t("pairing.tailscale.description")}
        actionUrl={query.data?.actionUrl}
        error={setUp.error?.message ?? query.error?.message ?? null}
        onSetUp={handleSetUp}
        onRetry={handleRetry}
      />
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("pairing.routes.relayTitle")}</Text>
          <Text style={settingsStyles.rowHint}>{t("pairing.routes.relayDescription")}</Text>
          {props.enableError ? (
            <Text style={settingsStyles.rowError}>{props.enableError.message}</Text>
          ) : null}
        </View>
        <View style={styles.routeTrailing}>
          {props.relayEnabled !== undefined ? (
            <StatusBadge
              label={props.relayEnabled ? t("pairing.routes.on") : t("pairing.routes.off")}
              variant={props.relayEnabled ? "success" : "muted"}
            />
          ) : null}
          {props.relayEnabled === false && props.canConfigureRelay ? (
            <Button
              variant="outline"
              size="sm"
              loading={props.enablePending}
              onPress={props.onEnableRelay}
            >
              {t("pairing.routes.turnOn")}
            </Button>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: theme.spacing[4],
  },
  routeTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  stateLine: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
    paddingVertical: theme.spacing[6],
  },
  consent: {
    gap: theme.spacing[4],
  },
  hero: {
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  heroBadge: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing[1],
  },
  consentTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  consentDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.5,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  directRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[4],
  },
  directIcon: {
    color: theme.colors.foregroundMuted,
    marginTop: 1, // optical: seats the glyph on the hint's first text line
  },
  directHint: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
  },
}));
