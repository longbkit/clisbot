import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
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
import { useSessionStore } from "@/stores/session-store";
import { useHubAccount } from "../account-provider";
import { hasIndependentHostCredential } from "./independent-host-credential";
import {
  useManagedAccessTransition,
  type ManagedAccessTransition,
} from "./managed-access-transition";

/** Clisbot-owned mount for the daemon policy; the generic Host page stays transport-agnostic. */
export function ManagedAccessHostSection({ host }: { host: HostProfile }) {
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
    <SettingsSection title="Managed access">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Require Hub access externally</Text>
            <Text style={settingsStyles.rowHint}>
              {managedAccessDescription(external, devicePairing)}
            </Text>
          </View>
          <Switch
            value={external}
            onValueChange={changeExternalMode}
            disabled={!isOwner || switching || isLoading || config === null}
            accessibilityLabel="Require Hub access for external connections"
          />
        </View>
      </View>
      <ManagedAccessNotice
        transition={transition}
        devicePairing={devicePairing}
        onPair={openPairLink}
      />
      <PairLinkModal visible={pairLinkVisible} onClose={closePairLink} onSaved={savePairLink} />
      {!isOwner ? (
        <Alert
          variant="info"
          title="Only an organization owner can change this security boundary."
        />
      ) : null}
    </SettingsSection>
  );
}

function managedAccessDescription(external: boolean, devicePairing: boolean): string {
  if (external)
    return "External sessions must use a short-lived Hub ticket and receive only their granted resources.";
  if (devicePairing)
    return "This Host requires its own paired device credential. Hub login does not grant access.";
  return "Upstream-compatible trusted access is active for this Host.";
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
  if (transition.status === "pairing-required") {
    return (
      <Alert
        variant="info"
        title="Managed access is off · Pair this device"
        description="Hub sign-in no longer grants access to this Host. Ask the Host owner for a fresh Host pairing link or QR, then paste its link to connect this device. Your Hub connection stays available."
      >
        <Button variant="outline" onPress={onPair}>
          Pair this device
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
            ? "Turning on managed access…"
            : "Turning off managed access…"
        }
        description={managedAccessNoticeDescription("switching", transition.target, devicePairing)}
      />
    );
  }
  if (transition.status === "done") {
    return (
      <Alert
        variant="success"
        title={transition.mode === "external" ? "Managed access is on" : "Managed access is off"}
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
            ? "This Host requires its own device credential. If this device's credential was revoked, pair it again with a fresh link from the Host owner."
            : undefined
        }
      >
        {devicePairing && transition.mode === "off" ? (
          <Button variant="outline" onPress={onPair}>
            Pair this device
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
    if (mode === "external")
      return "The Host closes sessions without a Hub ticket, including this one. Clisbot reconnects with a ticket from Hub.";
    if (devicePairing)
      return "This device reconnects using its own Host credential. If it has not paired with the Host, a new pairing link is required.";
    return "Clisbot reconnects to the Host.";
  }
  if (mode === "external")
    return "This device reconnected with a Hub ticket. Other external clients need a Hub sign-in and an access grant.";
  if (devicePairing)
    return "This device connected with its own Host credential. Other devices must pair with this Host; Hub sign-in does not grant access.";
  return "External clients use ordinary trusted access again.";
}

function modeChangeMessage(enabled: boolean, devicePairing: boolean): string {
  if (enabled)
    return "External TCP, relay, LAN, Tailscale, and tunnel connections will need a current Hub sign-in and access grant. Sessions without a Hub ticket close, including this one; Clisbot reconnects it with a ticket.";
  if (devicePairing)
    return "Hub sign-in and access grants will no longer authorize connections to this Host. Each device needs its own Host pairing credential. Devices using only a Hub ticket disconnect and must pair with the Host; your Hub connection stays available.";
  return "External clients will regain the ordinary trusted-operator access used by upstream Clisbot.";
}

function confirmModeChange(enabled: boolean, devicePairing: boolean): Promise<boolean> {
  return confirmDialog({
    title: enabled ? "Require Hub access?" : "Turn off managed access?",
    message: modeChangeMessage(enabled, devicePairing),
    confirmLabel: enabled ? "Require Hub access" : "Turn off",
    destructive: !enabled,
  });
}
