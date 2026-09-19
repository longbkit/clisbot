// Settings → Integrations: the apps the organization is connected to (a GitHub
// App install, a Slack app, Discord or Linear triggers) and the API keys scripts
// use. Channel bots are Connections under Channels, so they are not listed here
// once a Route uses them.

import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useHubAccount } from "../account-provider";
import { HubConnectionContinuationSchema, HubConnectionsSchema } from "../contracts";
import { buildHubSettingsRoute } from "../navigation";
import { useHubConnectionContinuation } from "../use-connection-continuation";
import { ApiKeySettings } from "./api-key-settings";
import { HubConnectionContinuationNotice } from "./connection-continuation";
import { HubConnectionResultNotice } from "./connection-result";
import { useHubResource } from "./hub-resource";
import { capitalizeLabel } from "./labels";
import { EmptyRow, ResourceFeedback } from "./resource-rows";
import { RowActionsMenu } from "./team/row-actions-menu";

type Connections = z.infer<typeof HubConnectionsSchema>;
type Connection = Connections["connections"][number];
type ProviderApplication = Connections["providerApplications"][number];

const INFO =
  "Apps your organization is connected to, such as a GitHub App install that starts Automations, and the API keys scripts use. A Channel bot is a Connection under Channels.";

export function IntegrationsSettings() {
  const hub = useHubAccount();
  const router = useRouter();
  const canManage = hub.signedIn?.capabilities.manageResources === true;
  const connections = useHubResource("connections", HubConnectionsSchema);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const openChannels = useCallback(() => router.push(buildHubSettingsRoute("channels")), [router]);
  const openChooser = useCallback(() => setChoosing(true), []);
  const closeChooser = useCallback(() => setChoosing(false), []);
  const disconnect = useDisconnect(connections.refetch, setError);
  const applications = connections.data?.providerApplications ?? [];
  const connectButton = useMemo(
    () =>
      canManage && applications.length > 0 ? (
        <Button size="sm" onPress={openChooser}>
          Connect…
        </Button>
      ) : null,
    [applications.length, canManage, openChooser],
  );
  const listed = (connections.data?.connections ?? []).filter(isIntegration);
  return (
    <View>
      <HubConnectionResultNotice />
      <SettingsSection title="Integrations" info={INFO} trailing={connectButton}>
        {error ? <Alert variant="error" title={error} /> : null}
        <ResourceFeedback query={connections} />
        {connections.data === undefined ? null : (
          <View style={settingsStyles.card}>
            {listed.length === 0 ? (
              <EmptyRow message="No apps are connected yet." />
            ) : (
              listed.map((connection, index) => (
                <IntegrationRow
                  key={connection.id}
                  connection={connection}
                  bordered={index > 0}
                  canManage={canManage}
                  disconnect={disconnect}
                />
              ))
            )}
          </View>
        )}
        <Button size="sm" variant="ghost" onPress={openChannels}>
          Channel bots are under Channels
        </Button>
      </SettingsSection>
      {canManage ? <ApiKeySettings /> : null}
      {choosing ? <ConnectSheet applications={applications} close={closeChooser} /> : null}
    </View>
  );
}

/** Listed here unless a Channel Route uses it: that one is managed with its Channel. */
function isIntegration(connection: Connection): boolean {
  return !connection.consumers.some((consumer) => consumer.resourceKind === "channel_account");
}

function useDisconnect(refetch: () => unknown, setError: (message: string | null) => void) {
  const hub = useHubAccount();
  return useCallback(
    async (connection: Connection) => {
      const confirmed = await confirmDialog({
        title: `Disconnect ${connection.name}?`,
        message: "Its saved credential and the Channel identities linked through it are removed.",
        confirmLabel: "Disconnect",
        destructive: true,
      });
      if (!confirmed) return;
      setError(null);
      try {
        await hub.api().delete(`connections/${encodeURIComponent(connection.id)}`);
        await refetch();
      } catch (error) {
        setError(error instanceof Error ? error.message : "Hub request failed.");
      }
    },
    [hub, refetch, setError],
  );
}

function IntegrationRow({
  connection,
  bordered,
  canManage,
  disconnect,
}: {
  connection: Connection;
  bordered: boolean;
  canManage: boolean;
  disconnect(connection: Connection): Promise<void>;
}) {
  const used = connection.consumers.map(({ name }) => name).join(", ");
  const actions = useMemo(
    () => [
      {
        label: connection.consumers.length > 0 ? "Disconnect (in use)" : "Disconnect",
        onSelect: () => void disconnect(connection),
        destructive: true,
        disabled: connection.consumers.length > 0,
      },
    ],
    [connection, disconnect],
  );
  const connected = connection.status === "connected";
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null, styles.row]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {`${capitalizeLabel(connection.provider)} · ${connection.name}`}
        </Text>
        {connection.externalName ? (
          <Text style={settingsStyles.rowHint}>{connection.externalName}</Text>
        ) : null}
        <Text style={settingsStyles.rowHint}>
          {used.length === 0 ? "Not used yet" : `Used by ${used}`}
        </Text>
      </View>
      <StatusBadge
        label={connected ? "Connected" : capitalizeLabel(connection.status)}
        variant={connected ? "success" : "warning"}
      />
      {canManage ? (
        <RowActionsMenu
          label={`Actions for ${connection.name}`}
          actions={actions}
          disabled={false}
        />
      ) : null}
    </View>
  );
}

/** Pick which app to connect; the provider's own page takes it from there. */
function ConnectSheet({
  applications,
  close,
}: {
  applications: readonly ProviderApplication[];
  close(): void;
}) {
  const hub = useHubAccount();
  const continuation = useHubConnectionContinuation();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connect = useCallback(
    async (application: ProviderApplication) => {
      setError(null);
      continuation.dismiss();
      setPendingId(application.id);
      try {
        const result = await hub
          .api()
          .post(
            "connections",
            { provider: application.provider, providerApplicationId: application.id },
            HubConnectionContinuationSchema,
          );
        await continuation.open(result.url);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Hub request failed.");
      } finally {
        setPendingId(null);
      }
    },
    [continuation, hub],
  );
  const header = useMemo(() => ({ title: "Connect an app" }), []);
  return (
    <AdaptiveModalSheet visible header={header} onClose={close} desktopMaxWidth={480}>
      <View style={styles.sheet}>
        <HubConnectionContinuationNotice continuation={continuation} />
        {error ? <Alert variant="error" title={error} /> : null}
        {applications.map((application) => (
          <ConnectApplicationButton
            key={`${application.provider}:${application.id}`}
            application={application}
            disabled={pendingId !== null || continuation.pending}
            loading={pendingId === application.id}
            connect={connect}
          />
        ))}
      </View>
    </AdaptiveModalSheet>
  );
}

function ConnectApplicationButton({
  application,
  disabled,
  loading,
  connect,
}: {
  application: ProviderApplication;
  disabled: boolean;
  loading: boolean;
  connect(application: ProviderApplication): Promise<void>;
}) {
  const press = useCallback(() => void connect(application), [application, connect]);
  return (
    <Button variant="outline" disabled={disabled} loading={loading} onPress={press}>
      {`${capitalizeLabel(application.provider)} · ${application.name}`}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { alignItems: "center", flexDirection: "row", gap: theme.spacing[3] },
  sheet: { gap: theme.spacing[3] },
}));
