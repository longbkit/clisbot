import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  ConnectorAccount,
  ConnectorAppState,
  ConnectorCatalogItem,
} from "@clisbot/protocol/connectors/types";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { ConnectAccountSheet } from "./connect-account-sheet";
import { useConnectAccount, type ConnectAccount } from "./use-connect-account";
import { DetailHeader, ToolsSection, UsedBySection } from "./connector-detail-parts";
import { connectorKeys, removeAccount, useConnectorTools } from "./data";
import { queryClient } from "@/data/query-client";
import {
  ACCOUNT_STATUS_LABELS,
  APP_STATE_VARIANTS,
  accountLabel,
  accountState,
  appState,
  type ConnectorUse,
} from "./model";
import { toErrorMessage } from "@/utils/error-messages";

/** One app: its accounts on this Host, the Bots and Projects that use it, and its tools. */
export function ConnectorAppDetail({
  serverId,
  item,
  app,
  accountsError,
  uses,
}: {
  serverId: string;
  item: ConnectorCatalogItem;
  app: ConnectorAppState | undefined;
  /** Set when the Host's accounts could not be read at all: unknown, not "none". */
  accountsError: Error | null;
  uses: ConnectorUse[];
}) {
  const accounts = app?.accounts ?? [];
  const connect = useConnectAccount(serverId, item.slug);
  const tools = useConnectorTools(
    serverId,
    useMemo(() => ({ app: item.slug }), [item.slug]),
  );
  const needsName = accounts.length > 0;
  const subtitle = [
    item.description,
    item.toolsCount ? `${item.toolsCount} tools` : null,
    "via Composio",
  ]
    .filter(Boolean)
    .join(" · ");
  const action = (
    <Button
      variant={needsName ? "outline" : "default"}
      size="sm"
      loading={connect.busy}
      onPress={needsName ? connect.askName : connect.start}
      testID="connectors-connect"
    >
      {needsName ? "Connect another account" : "Connect"}
    </Button>
  );
  return (
    <View>
      <DetailHeader
        slug={item.slug}
        name={item.name}
        logo={item.logo}
        subtitle={subtitle}
        action={item.noAuth ? undefined : action}
      />
      <ConnectFeedback
        connect={connect}
        waiting={accounts.some((account) => accountState(account) === "pending")}
      />
      {item.noAuth ? null : (
        <AccountsSection
          serverId={serverId}
          accounts={accounts}
          error={accountsError}
          // Composio names a new account when another one works; a broken one alone needs no name.
          onRetry={
            accounts.some((account) => account.status === "ACTIVE")
              ? connect.askName
              : connect.start
          }
        />
      )}
      <UsedBySection
        serverId={serverId}
        uses={uses}
        empty={
          appState(accounts) === "connected"
            ? `Nothing uses ${item.name} yet. Add it in a Bot's or Project's settings → Connectors.`
            : `Connect an account, then add ${item.name} to a Bot or Project.`
        }
      />
      <ToolsSection
        toolkit={item.slug}
        tools={tools.data}
        loading={tools.isLoading}
        error={tools.error}
      />
      <ConnectAccountSheet
        visible={connect.naming}
        appName={item.name}
        onClose={connect.closeName}
        onSubmit={connect.startNamed}
      />
    </View>
  );
}

/** What became of the last Connect: why it failed, or the sign-in link to open again. */
function ConnectFeedback({
  connect,
  waiting,
}: {
  connect: ConnectAccount;
  /** An account still waits for its sign-in; once none does, the link is no longer needed. */
  waiting: boolean;
}) {
  if (connect.error) {
    return (
      <Text accessibilityRole="alert" style={[settingsStyles.rowError, styles.feedback]}>
        {connect.error}
      </Text>
    );
  }
  if (!connect.link || !waiting) return null;
  return (
    <View style={[settingsStyles.card, styles.feedback]}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Finish signing in in your browser</Text>
          <Text style={settingsStyles.rowHint}>
            The page did not open, or you closed it? Open it again; the link works for ten minutes.
          </Text>
        </View>
        <Button
          size="sm"
          variant="outline"
          onPress={connect.reopen}
          testID="connectors-reopen-sign-in"
        >
          Open sign-in
        </Button>
      </View>
    </View>
  );
}

function AccountsSection({
  serverId,
  accounts,
  error,
  onRetry,
}: {
  serverId: string;
  accounts: ConnectorAccount[];
  error: Error | null;
  onRetry(): void;
}) {
  return (
    <SettingsSection
      title="Accounts"
      info="Up to five accounts per app. Bots and Projects use the accounts you connect here."
    >
      <View style={settingsStyles.card}>
        {accounts.length === 0 ? (
          <View style={settingsStyles.row}>
            <Text style={error ? settingsStyles.rowError : settingsStyles.rowHint}>
              {error
                ? `Accounts could not be read from Composio: ${error.message}`
                : "No account connected. Connect opens the sign-in in your browser."}
            </Text>
          </View>
        ) : (
          accounts.map((account, index) => (
            <AccountRow
              key={account.id}
              serverId={serverId}
              account={account}
              bordered={index > 0}
              onRetry={onRetry}
            />
          ))
        )}
      </View>
    </SettingsSection>
  );
}

function AccountRow({
  serverId,
  account,
  bordered,
  onRetry,
}: {
  serverId: string;
  account: ConnectorAccount;
  bordered: boolean;
  onRetry(): void;
}) {
  const state = accountState(account);
  const [error, setError] = useState<string | null>(null);
  const check = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: connectorKeys.accounts(serverId) }),
    [serverId],
  );
  const disconnect = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: `Disconnect ${accountLabel(account)}?`,
      message: "Agents lose access to this account at once. Composio revokes the sign-in.",
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!confirmed) return;
    setError(null);
    await removeAccount(serverId, account.id).catch((cause: unknown) =>
      setError(toErrorMessage(cause)),
    );
  }, [account, serverId]);
  const disconnectPress = useCallback(() => void disconnect(), [disconnect]);
  return (
    <View
      style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}
      testID={`connectors-account-${account.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{accountLabel(account)}</Text>
        <Text style={settingsStyles.rowHint}>{account.id}</Text>
        {error ? (
          <Text accessibilityRole="alert" style={settingsStyles.rowError}>
            {error}
          </Text>
        ) : null}
      </View>
      <View style={styles.accountActions}>
        <StatusBadge label={ACCOUNT_STATUS_LABELS[state]} variant={APP_STATE_VARIANTS[state]} />
        {state === "pending" ? (
          <Button size="xs" variant="outline" onPress={check}>
            Check status
          </Button>
        ) : null}
        {state === "attention" ? (
          <Button size="xs" variant="outline" onPress={onRetry}>
            Sign in again
          </Button>
        ) : null}
        <Button size="xs" variant="ghost" onPress={disconnectPress}>
          Disconnect
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  feedback: { marginBottom: theme.spacing[4] },
  accountActions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
}));
