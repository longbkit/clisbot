import { AdvancedConfigurationSection, useChannelYamlForm } from "./channel-advanced-configuration";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Activity, FileCode2, History, RefreshCw } from "lucide-react-native";
import { ChannelActionsMenu } from "./channel-actions-menu";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { parseChannelConfigurationYaml } from "../channel-configuration";
import { QueryFeedback, EmptyRow } from "./access-settings-feedback";
import {
  type ConnectionsPanel,
  EMPTY_RECORD,
  type EditingRoute,
  type HubChannelConfiguration,
  type HubConnection,
  type HubConnections,
  type HubRevision,
  type HubRuntimeStatus,
  type RecordValue,
} from "./channel-settings-types";
import { channelAccountKey, stringField } from "./channel-settings-records";
import { ChannelRevisionHistory } from "./channel-revision-history";
import {
  type ChannelAccountListProps,
  ChannelAccountRow,
  UnroutedConnectionCard,
} from "./channel-connection-card";

/**
 * Revision history and Advanced YAML: organization-wide and rarely needed, so
 * they open from the Connections menu above the list, one at a time.
 */
export function ChannelConfigurationExtras({
  panel,
  close,
  revisions,
  channels,
  yamlForm,
  error,
  pending,
  validate,
  save,
}: {
  panel: ConnectionsPanel | null;
  close(): void;
  revisions: HubRevision[] | undefined;
  channels: HubChannelConfiguration | undefined;
  yamlForm: ReturnType<typeof useChannelYamlForm>;
  error: string | null;
  pending: boolean;
  validate(candidate: ReturnType<typeof parseChannelConfigurationYaml>): Promise<void>;
  save(candidate: ReturnType<typeof parseChannelConfigurationYaml>): Promise<boolean>;
}) {
  if (panel === "history")
    return (
      <ChannelRevisionHistory
        revisions={revisions}
        activeRevisionId={channels?.revision?.id}
        close={close}
      />
    );
  if (panel === "yaml")
    return (
      <AdvancedConfigurationSection
        model={yamlForm}
        error={error}
        channels={channels}
        pending={pending}
        validate={validate}
        save={save}
        close={close}
      />
    );
  return null;
}

export function ChannelAccountsSection({
  channels,
  connections,
  runtimeStatus,
  queries,
  refreshing,
  mutationError,
  testResult,
  adminScoped,
  pending,
  refreshStatus,
  openPanel,
  updateAccount,
  removeAccount,
  retryAccount,
  editRoute,
  channelConnections,
  addConnection,
  addRouteTo,
  addRouteToConnection,
  disconnectConnection,
  openActivity,
  sendTestMessage,
  moveRoute,
  removeRoute,
  children,
}: {
  channels: HubChannelConfiguration | undefined;
  connections: HubConnections | undefined;
  runtimeStatus: HubRuntimeStatus | undefined;
  queries: Array<{ isPending: boolean; error: Error | null }>;
  refreshing: boolean;
  mutationError: string | null;
  testResult: string | null;
  /** A Connection Admin: their accounts only, nothing organization-wide. */
  adminScoped: boolean;
  pending: boolean;
  refreshStatus(): void;
  openPanel(panel: ConnectionsPanel): void;
  updateAccount(account: RecordValue, patch: RecordValue): Promise<void>;
  removeAccount(account: RecordValue): Promise<void>;
  retryAccount(account: RecordValue): Promise<void>;
  editRoute(route: EditingRoute): void;
  /** The channel Connections the Route form can pick, with or without Routes. */
  channelConnections: HubConnection[];
  addConnection(): void;
  addRouteTo(accountKey: string): void;
  addRouteToConnection(connectionId: string): void;
  disconnectConnection(connection: HubConnection): Promise<void>;
  openActivity(accountKey: string | null): void;
  sendTestMessage(account: RecordValue, conversationId: string): Promise<void>;
  moveRoute(account: RecordValue, from: number, to: number): Promise<void>;
  removeRoute(account: RecordValue, routeIndex: number): Promise<void>;
  /** The panel opened from the page menu, shown above the list. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const trailing = useMemo(
    () => (
      <ConnectionsPageActions
        adminScoped={adminScoped}
        pending={pending}
        refreshing={refreshing}
        addConnection={addConnection}
        refreshStatus={refreshStatus}
        openActivity={openActivity}
        openPanel={openPanel}
      />
    ),
    [adminScoped, addConnection, openActivity, openPanel, pending, refreshStatus, refreshing],
  );
  return (
    <SettingsSection
      title={t("hub.channels.accounts.title")}
      info={t("hub.channels.accounts.info")}
      trailing={trailing}
    >
      <QueryFeedback queries={queries} />
      {mutationError ? <Alert variant="error" title={mutationError} /> : null}
      {testResult ? <Alert variant="success" title={testResult} /> : null}
      {children}
      <ChannelAccountList
        accounts={channels?.accounts ?? []}
        policy={channels?.policy}
        // A Connection Admin never routes a Connection that is not already theirs.
        unroutedConnections={
          adminScoped ? [] : unroutedConnections(channelConnections, channels?.accounts ?? [])
        }
        addRouteToConnection={addRouteToConnection}
        disconnectConnection={disconnectConnection}
        resource={channels?.resource ?? EMPTY_RECORD}
        connections={connections?.connections ?? []}
        runtimes={runtimeStatus?.accounts ?? []}
        runtimeAvailable={runtimeStatus?.runtimeAvailable}
        warnings={channels?.warnings}
        revisionVersion={channels?.revision?.version}
        adminScoped={adminScoped}
        pending={pending}
        openActivity={openActivity}
        updateAccount={updateAccount}
        removeAccount={removeAccount}
        retryAccount={retryAccount}
        editRoute={editRoute}
        addRouteTo={addRouteTo}
        sendTestMessage={sendTestMessage}
        moveRoute={moveRoute}
        removeRoute={removeRoute}
      />
    </SettingsSection>
  );
}

/**
 * One visible add, then a menu for what is checked now and then: status,
 * activity, and the organization-wide revision history and YAML.
 */
function ConnectionsPageActions({
  adminScoped,
  pending,
  refreshing,
  addConnection,
  refreshStatus,
  openActivity,
  openPanel,
}: {
  adminScoped: boolean;
  pending: boolean;
  refreshing: boolean;
  addConnection(): void;
  refreshStatus(): void;
  openActivity(accountKey: string | null): void;
  openPanel(panel: ConnectionsPanel): void;
}) {
  const { t } = useTranslation();
  const actions = useMemo(
    () => [
      ...(refreshing
        ? []
        : [
            {
              label: t("hub.channels.accounts.refreshStatus"),
              icon: RefreshCw,
              onSelect: refreshStatus,
            },
          ]),
      {
        label: t("hub.channels.accounts.viewActivity"),
        icon: Activity,
        onSelect: () => openActivity(null),
      },
      ...(adminScoped
        ? []
        : [
            {
              label: t("hub.channels.accounts.revisionHistory"),
              icon: History,
              onSelect: () => openPanel("history"),
            },
            {
              label: t("hub.channels.accounts.advancedYaml"),
              icon: FileCode2,
              onSelect: () => openPanel("yaml"),
            },
          ]),
    ],
    [adminScoped, openActivity, openPanel, refreshStatus, refreshing, t],
  );
  return (
    <View style={styles.headerActions}>
      {/* A Connection Admin cannot connect a bot: they add Routes on their own. */}
      {adminScoped ? null : (
        <Button size="xs" variant="outline" disabled={pending} onPress={addConnection}>
          {t("hub.channels.accounts.addConnection")}
        </Button>
      )}
      <ChannelActionsMenu
        label={t("hub.channels.accounts.moreActions")}
        disabled={false}
        actions={actions}
      />
    </View>
  );
}

/**
 * Every Connection with its Routes, on one screen: one compact card per
 * Connection, so a Hub with dozens of them stays scannable and every Route is
 * one click from its form.
 */
function ChannelAccountList({
  accounts,
  unroutedConnections: unrouted,
  addRouteToConnection,
  disconnectConnection,
  ...props
}: ChannelAccountListProps) {
  const { t } = useTranslation();
  if (accounts.length === 0 && unrouted.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <EmptyRow
          message={
            props.adminScoped
              ? t("hub.channels.accounts.emptyShared")
              : t("hub.channels.accounts.empty")
          }
        />
      </View>
    );
  }
  return (
    <View style={styles.connectionList}>
      {accounts.map((account) => (
        <ChannelAccountRow key={channelAccountKey(account)} account={account} {...props} />
      ))}
      {unrouted.map((connection) => (
        <UnroutedConnectionCard
          key={connection.id}
          connection={connection}
          pending={props.pending}
          addRoute={addRouteToConnection}
          disconnect={disconnectConnection}
        />
      ))}
    </View>
  );
}

/** The channel Connections no account points at. */
function unroutedConnections(
  connections: readonly HubConnection[],
  accounts: readonly RecordValue[],
): HubConnection[] {
  const used = new Set(accounts.map((account) => stringField(account, "connectionId")));
  return connections.filter(({ id }) => !used.has(id));
}

const styles = StyleSheet.create((theme) => ({
  connectionList: {
    gap: theme.spacing[3],
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[2],
    // The card's row padding and border: the page's actions stand over the
    // Connection cards' own, in one column.
    paddingRight: theme.spacing[4] + 1,
  },
}));
