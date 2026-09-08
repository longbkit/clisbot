import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import {
  channelSeverityVariant,
  type ChannelAccountHealth,
  type ChannelCatalogRow,
} from "../channel-account-health";

/**
 * The selected channel: what it needs, how it connects, and the health of every
 * account configured for it.
 */
export function ChannelCatalogDetail({
  row,
  onConnect,
}: {
  row: ChannelCatalogRow;
  onConnect?: (() => void) | undefined;
}) {
  return (
    <SettingsSection title={row.label}>
      {row.entry === undefined ? (
        <Alert
          variant="info"
          title="Not in this Hub's catalog"
          description="This Hub runs the channel but publishes no catalog entry for it. Its accounts and queue still appear here; its setup guidance does not."
        />
      ) : null}
      {row.status === "planned" ? (
        <Alert
          variant="info"
          title="Coming soon"
          description={`${row.label} has no runtime on this Hub yet, so it cannot be connected.`}
        />
      ) : null}
      {row.entry?.notes.map((note) => (
        <Text key={note} style={settingsStyles.rowHint}>
          {note}
        </Text>
      ))}
      {row.entry === undefined ? null : (
        <View style={settingsStyles.card}>
          {row.entry.transports.map((transport, index) => (
            <View
              key={transport.id}
              style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
            >
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>{transport.label}</Text>
                <Text style={settingsStyles.rowHint}>{transport.setup}</Text>
                <Text style={settingsStyles.rowHint}>
                  {`Requires ${transport.requiredConfig.join(", ")}`}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
      {row.entry !== undefined && row.entry.extraTools.length > 0 ? (
        <Text style={settingsStyles.rowHint}>
          {`Channel tools: ${row.entry.extraTools.join(", ")}`}
        </Text>
      ) : null}
      <ChannelAccountHealthCard accounts={row.accounts} />
      {onConnect === undefined || !row.connectable ? null : (
        <View style={styles.actions}>
          <Button size="sm" onPress={onConnect}>
            {`Connect ${row.label}`}
          </Button>
        </View>
      )}
    </SettingsSection>
  );
}

function ChannelAccountHealthCard({ accounts }: { accounts: readonly ChannelAccountHealth[] }) {
  if (accounts.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>No accounts are configured for this channel.</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={settingsStyles.card}>
      {accounts.map((account, index) => (
        <ChannelAccountHealthRow key={account.key} account={account} bordered={index > 0} />
      ))}
    </View>
  );
}

function ChannelAccountHealthRow({
  account,
  bordered,
}: {
  account: ChannelAccountHealth;
  bordered: boolean;
}) {
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{account.accountId}</Text>
        <Text style={settingsStyles.rowHint}>{identityLine(account)}</Text>
        <Text style={settingsStyles.rowHint}>{queueLine(account)}</Text>
        {account.detail === null ? null : (
          <Text style={settingsStyles.rowError}>{account.detail}</Text>
        )}
      </View>
      <StatusBadge
        label={account.enabled ? account.transportLabel : "Disabled"}
        variant={channelSeverityVariant(account.severity)}
      />
    </View>
  );
}

function identityLine(account: ChannelAccountHealth): string {
  if (account.identity !== null) return account.identity;
  if (account.connectionId === null) return "No Connection is referenced by this account.";
  return "The referenced Connection is unavailable.";
}

function queueLine(account: ChannelAccountHealth): string {
  if (account.ingressSummary === null) return "This Hub reports no queue depth for this account.";
  return account.oldestPending === null
    ? account.ingressSummary
    : `${account.ingressSummary} · oldest ${account.oldestPending}`;
}

const styles = StyleSheet.create((theme) => ({
  actions: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));
