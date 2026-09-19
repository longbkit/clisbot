import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { ChannelCatalogEntry } from "../channel-catalog";
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
      <ChannelAccountHealthCard accounts={row.accounts} />
      {onConnect === undefined || !row.connectable ? null : (
        <View style={styles.actions}>
          <Button size="sm" onPress={onConnect}>
            {`Connect ${row.label}`}
          </Button>
        </View>
      )}
      {row.entry === undefined ? null : <ChannelConnectGuide entry={row.entry} />}
    </SettingsSection>
  );
}

/** How a Connection of this channel is made, and what to know first. */
function ChannelConnectGuide({ entry }: { entry: ChannelCatalogEntry }) {
  const labels = new Map(entry.credentials.map(({ key, label }) => [key, label]));
  return (
    <>
      <Text style={styles.heading}>How it connects</Text>
      <View style={settingsStyles.card}>
        {entry.transports.map((transport, index) => (
          <View
            key={transport.id}
            style={[settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null]}
          >
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{transport.label}</Text>
              <Text style={settingsStyles.rowHint}>{transport.setup}</Text>
              <Text style={settingsStyles.rowHint}>
                {`Needs: ${transport.requiredConfig.map((key) => labels.get(key) ?? key).join(", ")}`}
              </Text>
            </View>
          </View>
        ))}
      </View>
      {entry.notes.length === 0 ? null : (
        <>
          <Text style={styles.heading}>Before you connect</Text>
          {entry.notes.map((note) => (
            <Text key={note} style={settingsStyles.rowHint}>
              {note}
            </Text>
          ))}
        </>
      )}
    </>
  );
}

function ChannelAccountHealthCard({ accounts }: { accounts: readonly ChannelAccountHealth[] }) {
  if (accounts.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>No Connection uses this channel yet.</Text>
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
  if (account.connectionName !== null) {
    return account.identity === null
      ? account.connectionName
      : `${account.identity} · ${account.connectionName}`;
  }
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
  heading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    marginTop: theme.spacing[2],
  },
}));
