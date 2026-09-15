import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import type { ManagedAccessMode } from "@getpaseo/protocol/managed-access";
import { Alert } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  hostSessionHubManagement,
  subscribeHostSessionAccess,
} from "@/runtime/host-session-access";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useHubAccount } from "../account-provider";
import {
  useManagedAccessTransition,
  type ManagedAccessTransition,
} from "./managed-access-transition";

/** Clisbot-owned mount for the daemon policy; the generic Host page stays transport-agnostic. */
export function ManagedAccessHostSection({ host }: { host: HostProfile }) {
  const hub = useHubAccount();
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
  const { transition, switchMode } = useManagedAccessTransition({
    serverId: host.serverId,
    scope,
    daemonMode: config?.managedAccess.mode,
    applyMode,
  });
  const switching = transition.status === "switching";
  const external = switching
    ? transition.target === "external"
    : config?.managedAccess.mode === "external";

  const changeExternalMode = useCallback(
    (enabled: boolean) => {
      void (async () => {
        if (await confirmModeChange(enabled)) await switchMode(enabled ? "external" : "off");
      })();
    },
    [switchMode],
  );

  if (!managedByCurrentHub) return null;

  return (
    <SettingsSection title="Managed access">
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
            disabled={!isOwner || switching || isLoading || config === null}
            accessibilityLabel="Require Hub access for external connections"
          />
        </View>
      </View>
      <ManagedAccessNotice transition={transition} />
      {!isOwner ? (
        <Alert
          variant="info"
          title="Only an organization owner can change this security boundary."
        />
      ) : null}
    </SettingsSection>
  );
}

function ManagedAccessNotice({ transition }: { transition: ManagedAccessTransition }) {
  if (transition.status === "switching") {
    return (
      <Alert
        variant="info"
        title={
          transition.target === "external"
            ? "Turning on managed access…"
            : "Turning off managed access…"
        }
        description={
          transition.target === "external"
            ? "The Host closes sessions without a Hub ticket, including this one. Paseo reconnects with a ticket from Hub."
            : "Paseo reconnects to the Host."
        }
      />
    );
  }
  if (transition.status === "done") {
    return (
      <Alert
        variant="success"
        title={transition.mode === "external" ? "Managed access is on" : "Managed access is off"}
        description={
          transition.mode === "external"
            ? "This device reconnected with a Hub ticket. Other external clients need a Hub sign-in and an access grant."
            : "External clients use ordinary trusted access again."
        }
      />
    );
  }
  if (transition.status === "failed") {
    return <Alert variant="error" title={transition.message} />;
  }
  return null;
}

function confirmModeChange(enabled: boolean): Promise<boolean> {
  return confirmDialog({
    title: enabled ? "Require Hub access?" : "Turn off managed access?",
    message: enabled
      ? "External TCP, relay, LAN, Tailscale, and tunnel connections will need a current Hub sign-in and access grant. Sessions without a Hub ticket close, including this one; Paseo reconnects it with a ticket."
      : "External clients will regain the ordinary trusted-operator access used by upstream Paseo.",
    confirmLabel: enabled ? "Require Hub access" : "Turn off",
    destructive: !enabled,
  });
}
