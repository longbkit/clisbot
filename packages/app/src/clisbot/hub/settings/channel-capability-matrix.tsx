import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import {
  CHANNEL_CAPABILITY_STATE_LABELS,
  channelCapabilityVariant,
  deriveChannelCapabilities,
  summarizeChannelCapabilities,
  type ChannelCapabilityAccount,
  type ChannelCapabilityRow,
} from "../channel-capability";
import type { ChannelCatalogEntry } from "../channel-catalog";

/**
 * What this Channel account can do, and how confident the answer is. `Not
 * verified` is the honest default for a running account: the catalog claims the
 * capability and the Hub reports no evidence either way.
 */
export function ChannelCapabilityMatrix({
  entry,
  account,
}: {
  entry: ChannelCatalogEntry;
  account: ChannelCapabilityAccount | null;
}) {
  const rows = deriveChannelCapabilities(entry, account);
  const totals = summarizeChannelCapabilities(rows);
  const summary = (["available", "notVerified", "restricted", "needsSetup", "unsupported"] as const)
    .filter((state) => totals[state] > 0)
    .map(
      (state) => `${String(totals[state])} ${CHANNEL_CAPABILITY_STATE_LABELS[state].toLowerCase()}`,
    )
    .join(" · ");
  return (
    <SettingsSection title="Capabilities">
      <Text style={settingsStyles.rowHint}>{summary}</Text>
      <View style={settingsStyles.card}>
        {rows.map((row, index) => (
          <CapabilityRow key={row.capability} row={row} bordered={index > 0} />
        ))}
      </View>
    </SettingsSection>
  );
}

function CapabilityRow({ row, bordered }: { row: ChannelCapabilityRow; bordered: boolean }) {
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{row.label}</Text>
        <Text style={settingsStyles.rowHint}>{row.reason}</Text>
        {row.nextAction === null ? null : <Text style={styles.nextAction}>{row.nextAction}</Text>}
      </View>
      <StatusBadge
        label={CHANNEL_CAPABILITY_STATE_LABELS[row.state]}
        variant={channelCapabilityVariant(row.state)}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  nextAction: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
}));
