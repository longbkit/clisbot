import { useCallback, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  hostSessionHubManagement,
  subscribeHostSessionAccess,
} from "@/runtime/host-session-access";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useHubAccount } from "../account-provider";

/** Clisbot-owned mount for the daemon policy; the generic Host page stays transport-agnostic. */
export function ManagedAccessHostSection({ host }: { host: HostProfile }) {
  const hub = useHubAccount();
  const { config, isLoading, patchConfig } = useDaemonConfig(host.serverId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    (hub.signedIn.status === "appSetupRequired" ||
      (hub.signedIn.status === "active" && hub.signedIn.membership.role === "owner"));
  const external = config?.managedAccess.mode === "external";

  const changeMode = useCallback(
    async (enabled: boolean) => {
      const confirmed = await confirmDialog({
        title: enabled ? "Require Hub access?" : "Turn off managed access?",
        message: enabled
          ? "External TCP, relay, LAN, Tailscale, and tunnel connections will require a current Hub sign-in and access grant. Existing unticketed external sessions will close."
          : "External clients will regain the ordinary trusted-operator access used by upstream Paseo.",
        confirmLabel: enabled ? "Require Hub access" : "Turn off",
        destructive: !enabled,
      });
      if (!confirmed) return;
      setPending(true);
      setError(null);
      try {
        await patchConfig({ managedAccess: { mode: enabled ? "external" : "off" } });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to update managed access.");
      } finally {
        setPending(false);
      }
    },
    [patchConfig],
  );
  const changeExternalMode = useCallback(
    (value: boolean) => {
      void changeMode(value);
    },
    [changeMode],
  );

  if (!managedByCurrentHub) return null;

  return (
    <SettingsSection title="Managed access">
      {error ? <Alert variant="error" title={error} /> : null}
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>Require Hub access externally</Text>
            <Text style={settingsStyles.rowHint}>
              {external
                ? "External sessions must use a short-lived Hub ticket and receive only their granted resources."
                : "Upstream-compatible trusted access is active for this Host."}
            </Text>
          </View>
          <Switch
            value={external}
            onValueChange={changeExternalMode}
            disabled={!isOwner || pending || isLoading || config === null}
            accessibilityLabel="Require Hub access for external connections"
          />
        </View>
      </View>
      {!isOwner ? (
        <Alert
          variant="info"
          title="Only an organization owner can change this security boundary."
        />
      ) : null}
    </SettingsSection>
  );
}
