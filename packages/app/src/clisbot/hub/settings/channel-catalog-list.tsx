import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { channelPrerequisiteSummary } from "../channel-catalog";
import {
  CHANNEL_STATUS_LABELS,
  channelSeverityVariant,
  type ChannelCatalogRow,
} from "../channel-account-health";
import type { ChannelIngressSeverity } from "../channel-ingress-operations";

/** Every channel the Hub's catalog publishes, plus anything else it runs. */
export function ChannelCatalogList({
  rows,
  selected,
  onSelect,
}: {
  rows: readonly ChannelCatalogRow[];
  selected: string | null;
  onSelect(channel: string): void;
}) {
  return (
    <View style={settingsStyles.card}>
      {rows.map((row, index) => (
        <ChannelCatalogListRow
          key={row.channel}
          row={row}
          bordered={index > 0}
          selected={row.channel === selected}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

function ChannelCatalogListRow({
  row,
  bordered,
  selected,
  onSelect,
}: {
  row: ChannelCatalogRow;
  bordered: boolean;
  selected: boolean;
  onSelect(channel: string): void;
}) {
  const press = useCallback(() => onSelect(row.channel), [onSelect, row.channel]);
  const state = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={state}
      onPress={press}
      style={[
        settingsStyles.row,
        bordered ? settingsStyles.rowBorder : null,
        selected ? styles.selected : null,
      ]}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{row.label}</Text>
        <Text style={settingsStyles.rowHint}>{prerequisites(row)}</Text>
        <Text style={settingsStyles.rowHint}>{accountSummary(row)}</Text>
      </View>
      <StatusBadge label={statusLabel(row)} variant={statusVariant(row)} />
    </Pressable>
  );
}

function prerequisites(row: ChannelCatalogRow): string {
  return row.entry === undefined
    ? "This Hub runs this channel but does not publish a catalog entry for it."
    : `Needs: ${channelPrerequisiteSummary(row.entry)}`;
}

function accountSummary(row: ChannelCatalogRow): string {
  if (row.accounts.length === 0) return "No accounts configured";
  const running = row.accounts.filter((account) => account.transport === "started").length;
  return `${String(row.accounts.length)} ${row.accounts.length === 1 ? "account" : "accounts"} · ${String(running)} running`;
}

function statusLabel(row: ChannelCatalogRow): string {
  if (row.status !== "in-repo") return CHANNEL_STATUS_LABELS[row.status];
  if (row.accounts.length === 0) return "Ready to connect";
  return row.accounts.some((account) => account.severity === "error") ? "Attention" : "Connected";
}

function statusVariant(row: ChannelCatalogRow): "success" | "warning" | "error" | "muted" {
  if (row.status === "planned") return "muted";
  if (row.accounts.length === 0) return "muted";
  return channelSeverityVariant(worstSeverity(row));
}

function worstSeverity(row: ChannelCatalogRow): ChannelIngressSeverity {
  if (row.accounts.some((account) => account.severity === "error")) return "error";
  if (row.accounts.some((account) => account.severity === "warning")) return "warning";
  return "ok";
}

const styles = StyleSheet.create((theme) => ({
  selected: {
    backgroundColor: theme.colors.surface2,
  },
}));
