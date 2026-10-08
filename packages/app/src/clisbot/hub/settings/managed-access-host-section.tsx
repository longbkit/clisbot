import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import type { ManagedAccessMode } from "@clisbot/protocol/managed-access";
import { Alert } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { PairLinkModal } from "@/components/pair-link-modal";
import { readDeviceCredential } from "@/device-access/credentials";
import { readDesktopManagedLocalCredential } from "@/desktop/daemon/local-credential";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  hostSessionHubManagement,
  subscribeHostSessionAccess,
} from "@/runtime/host-session-access";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { i18n } from "@/i18n/i18next";
import { useSessionStore } from "@/stores/session-store";
import { useHubAccount } from "../account-provider";
import { hasIndependentHostCredential } from "./independent-host-credential";
import {
  useManagedAccessTransition,
  type ManagedAccessTransition,
} from "./managed-access-transition";

/** Clisbot-owned mount for the daemon policy; the generic Host page stays transport-agnostic. */
export function ManagedAccessHostSection({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const [pairLinkVisible, setPairLinkVisible] = useState(false);
  const devicePairing = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.features?.devicePairing === true,
  );
  const { config, isLoading, patchConfig } = useDaemonConfig(host.serverId);
  const sessionManagement = useSyncExternalStore(
    subscribeHostSessionAccess,
    () => hostSessionHubManagement(host.serverId),
    () => undefined,
  );
  const management = host.management ?? sessionManagement;
  const managedByCurrentHub = management?.kind === "hub" && management.hubOrigin === hub.origin;
  const isOwner =
    managedByCurrentHub &&
    hub.signedIn?.organization.id === management.organizationId &&
    hub.signedIn.membership.role === "owner";
  const scope = useMemo(
    () => ({
      origin: hub.origin,
      organizationId: hub.signedIn?.organization.id ?? null,
      accountId: hub.signedIn?.account.id ?? null,
      daemonId: management?.daemonId ?? "",
    }),
    [hub.origin, hub.signedIn?.organization.id, hub.signedIn?.account.id, management?.daemonId],
  );
  const applyMode = useCallback(
    async (mode: ManagedAccessMode) => {
      await patchConfig({ managedAccess: { mode } });
    },
    [patchConfig],
  );
  const hasIndependentCredential = useCallback(
    () =>
      hasIndependentHostCredential(host, {
        readDeviceCredential,
        readDesktopManagedLocalCredential,
      }),
    [host],
  );
  const { transition, switchMode, finishPairing } = useManagedAccessTransition({
    serverId: host.serverId,
    scope,
    daemonMode: config?.managedAccess.mode,
    devicePairing,
    hasIndependentCredential,
    applyMode,
  });
  const openPairLink = useCallback(() => setPairLinkVisible(true), []);
  const closePairLink = useCallback(() => setPairLinkVisible(false), []);
  const savePairLink = useCallback(
    ({ serverId }: { serverId: string }) => {
      if (serverId === host.serverId) finishPairing();
    },
    [host.serverId, finishPairing],
  );
  const switching = transition.status === "switching";
  const external = switching
    ? transition.target === "external"
    : config?.managedAccess.mode === "external";

  const changeExternalMode = useCallback(
    (enabled: boolean) => {
      void (async () => {
        if (await confirmModeChange(enabled, devicePairing))
          await switchMode(enabled ? "external" : "off");
      })();
    },
    [switchMode, devicePairing],
  );

  if (!managedByCurrentHub) return null;

  return (
    <SettingsSection title={t("hub.settings.managedAccess.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("hub.settings.managedAccess.requireTitle")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {managedAccessDescription(external, devicePairing)}
            </Text>
          </View>
          <Switch
            value={external}
            onValueChange={changeExternalMode}
            disabled={!isOwner || switching || isLoading || config === null}
            accessibilityLabel={t("hub.settings.managedAccess.switchLabel")}
          />
        </View>
      </View>
      <ManagedAccessNotice
        transition={transition}
        devicePairing={devicePairing}
        onPair={openPairLink}
      />
      <PairLinkModal visible={pairLinkVisible} onClose={closePairLink} onSaved={savePairLink} />
      {!isOwner ? <Alert variant="info" title={t("hub.settings.managedAccess.ownerOnly")} /> : null}
    </SettingsSection>
  );
}

function managedAccessDescription(external: boolean, devicePairing: boolean): string {
  if (external) return i18n.t("hub.settings.managedAccess.descriptionExternal");
  if (devicePairing) return i18n.t("hub.settings.managedAccess.descriptionDevicePairing");
  return i18n.t("hub.settings.managedAccess.descriptionTrusted");
}

function ManagedAccessNotice({
  transition,
  devicePairing,
  onPair,
}: {
  transition: ManagedAccessTransition;
  devicePairing: boolean;
  onPair: () => void;
}) {
  const { t } = useTranslation();
  if (transition.status === "pairing-required") {
    return (
      <Alert
        variant="info"
        title={t("hub.settings.managedAccess.pairingRequiredTitle")}
        description={t("hub.settings.managedAccess.pairingRequiredDescription")}
      >
        <Button variant="outline" onPress={onPair}>
          {t("hub.settings.managedAccess.pairThisDevice")}
        </Button>
      </Alert>
    );
  }
  if (transition.status === "switching") {
    return (
      <Alert
        variant="info"
        title={
          transition.target === "external"
            ? t("hub.settings.managedAccess.turningOn")
            : t("hub.settings.managedAccess.turningOff")
        }
        description={managedAccessNoticeDescription("switching", transition.target, devicePairing)}
      />
    );
  }
  if (transition.status === "done") {
    return (
      <Alert
        variant="success"
        title={
          transition.mode === "external"
            ? t("hub.settings.managedAccess.isOn")
            : t("hub.settings.managedAccess.isOff")
        }
        description={managedAccessNoticeDescription("done", transition.mode, devicePairing)}
      />
    );
  }
  if (transition.status === "failed") {
    return (
      <Alert
        variant="error"
        title={transition.message}
        description={
          devicePairing && transition.mode === "off"
            ? t("hub.settings.managedAccess.failedDevicePairing")
            : undefined
        }
      >
        {devicePairing && transition.mode === "off" ? (
          <Button variant="outline" onPress={onPair}>
            {t("hub.settings.managedAccess.pairThisDevice")}
          </Button>
        ) : null}
      </Alert>
    );
  }
  return null;
}

function managedAccessNoticeDescription(
  status: "switching" | "done",
  mode: ManagedAccessMode,
  devicePairing: boolean,
): string {
  if (status === "switching") {
    if (mode === "external") return i18n.t("hub.settings.managedAccess.switchingExternal");
    if (devicePairing) return i18n.t("hub.settings.managedAccess.switchingDevicePairing");
    return i18n.t("hub.settings.managedAccess.switchingTrusted");
  }
  if (mode === "external") return i18n.t("hub.settings.managedAccess.doneExternal");
  if (devicePairing) return i18n.t("hub.settings.managedAccess.doneDevicePairing");
  return i18n.t("hub.settings.managedAccess.doneTrusted");
}

function modeChangeMessage(enabled: boolean, devicePairing: boolean): string {
  if (enabled) return i18n.t("hub.settings.managedAccess.confirmEnableMessage");
  if (devicePairing) return i18n.t("hub.settings.managedAccess.confirmDisableDevicePairingMessage");
  return i18n.t("hub.settings.managedAccess.confirmDisableTrustedMessage");
}

function confirmModeChange(enabled: boolean, devicePairing: boolean): Promise<boolean> {
  return confirmDialog({
    title: enabled
      ? i18n.t("hub.settings.managedAccess.confirmEnableTitle")
      : i18n.t("hub.settings.managedAccess.confirmDisableTitle"),
    message: modeChangeMessage(enabled, devicePairing),
    confirmLabel: enabled
      ? i18n.t("hub.settings.managedAccess.confirmEnableLabel")
      : i18n.t("hub.settings.managedAccess.confirmDisableLabel"),
    destructive: !enabled,
  });
}
