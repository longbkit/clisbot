// Settings → Integrations: the apps the organization is connected to (a GitHub
// App install, a Slack app, Discord or Linear triggers) and the API keys scripts
// use. Channel bots are Connections under Channels, so they are not listed here
// once a Route uses them.

import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { i18n } from "@/i18n/i18next";
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
import { SettingsLinkRow } from "./settings-link-row";

type Connections = z.infer<typeof HubConnectionsSchema>;
type Connection = Connections["connections"][number];
type ProviderApplication = Connections["providerApplications"][number];

export function IntegrationsSettings() {
  const { t } = useTranslation();
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
          {t("hub.settings.integrations.connectButton")}
        </Button>
      ) : null,
    [applications.length, canManage, openChooser, t],
  );
  const listed = (connections.data?.connections ?? []).filter(isIntegration);
  return (
    <View>
      <HubConnectionResultNotice />
      <SettingsSection
        title={t("hub.settings.integrations.title")}
        info={t("hub.settings.integrations.info")}
        trailing={connectButton}
      >
        {error ? <Alert variant="error" title={error} /> : null}
        <ResourceFeedback query={connections} />
        {connections.data === undefined ? null : (
          <View style={settingsStyles.card}>
            {listed.length === 0 ? (
              <EmptyRow message={emptyMessage(applications.length > 0)} />
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
            <View style={settingsStyles.rowBorder}>
              <SettingsLinkRow
                label={t("hub.settings.integrations.chatBots")}
                hint={t("hub.settings.integrations.chatBotsHint")}
                onPress={openChannels}
              />
            </View>
          </View>
        )}
      </SettingsSection>
      {canManage ? <ApiKeySettings /> : null}
      {choosing ? <ConnectSheet applications={applications} close={closeChooser} /> : null}
    </View>
  );
}

/** What an empty list says next: Connect when an app is offered, else where apps come from. */
function emptyMessage(canConnect: boolean): string {
  return canConnect
    ? i18n.t("hub.settings.integrations.emptyCanConnect")
    : i18n.t("hub.settings.integrations.emptyOperator");
}

/** Listed here unless a Channel Route uses it: that one is managed with its Channel. */
function isIntegration(connection: Connection): boolean {
  return !connection.consumers.some((consumer) => consumer.resourceKind === "channel_account");
}

function useDisconnect(refetch: () => unknown, setError: (message: string | null) => void) {
  const { t } = useTranslation();
  const hub = useHubAccount();
  return useCallback(
    async (connection: Connection) => {
      const confirmed = await confirmDialog({
        title: t("hub.settings.integrations.disconnectTitle", { name: connection.name }),
        message: t("hub.settings.integrations.disconnectMessage"),
        confirmLabel: t("hub.settings.integrations.disconnect"),
        destructive: true,
      });
      if (!confirmed) return;
      setError(null);
      try {
        await hub.api().delete(`connections/${encodeURIComponent(connection.id)}`);
        await refetch();
      } catch (error) {
        setError(
          error instanceof Error ? error.message : t("hub.settings.integrations.requestFailed"),
        );
      }
    },
    [hub, refetch, setError, t],
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
  const { t } = useTranslation();
  const used = connection.consumers.map(({ name }) => name).join(", ");
  const actions = useMemo(
    () => [
      {
        label:
          connection.consumers.length > 0
            ? t("hub.settings.integrations.disconnectInUse")
            : t("hub.settings.integrations.disconnect"),
        onSelect: () => void disconnect(connection),
        destructive: true,
        disabled: connection.consumers.length > 0,
      },
    ],
    [connection, disconnect, t],
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
          {used.length === 0
            ? t("hub.settings.integrations.notUsedYet")
            : t("hub.settings.integrations.usedBy", { names: used })}
        </Text>
      </View>
      <StatusBadge
        label={
          connected ? t("hub.settings.integrations.connected") : capitalizeLabel(connection.status)
        }
        variant={connected ? "success" : "warning"}
      />
      {canManage ? (
        <RowActionsMenu
          label={t("hub.settings.integrations.actionsFor", { name: connection.name })}
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
  const { t } = useTranslation();
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
        setError(
          cause instanceof Error ? cause.message : t("hub.settings.integrations.requestFailed"),
        );
      } finally {
        setPendingId(null);
      }
    },
    [continuation, hub, t],
  );
  const header = useMemo(() => ({ title: t("hub.settings.integrations.connectSheetTitle") }), [t]);
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
