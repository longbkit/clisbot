import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StatusBadge } from "@/components/ui/status-badge";
import { i18n } from "@/i18n/i18next";
import { settingsStyles } from "@/styles/settings";
import { tableStyles } from "./table-styles";
import { channelPrerequisiteSummary } from "../channel-catalog";
import {
  channelSeverityVariant,
  channelStatusLabel,
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
        tableStyles.body,
        selected ? tableStyles.selected : null,
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
    ? i18n.t("hub.channels.catalogList.noEntry")
    : i18n.t("hub.channels.catalogDetail.needs", { items: channelPrerequisiteSummary(row.entry) });
}

function accountSummary(row: ChannelCatalogRow): string {
  if (row.accounts.length === 0) return i18n.t("hub.channels.catalogList.noAccounts");
  const running = row.accounts.filter((account) => account.transport === "started").length;
  return i18n.t("hub.channels.catalogList.accounts", { count: row.accounts.length, running });
}

function statusLabel(row: ChannelCatalogRow): string {
  if (row.status !== "in-repo") return channelStatusLabel(row.status);
  if (row.accounts.length === 0) return i18n.t("hub.channels.catalogList.ready");
  if (row.accounts.some((account) => account.severity === "error")) {
    return i18n.t("hub.channels.catalogList.attention");
  }
  // A warning names itself ("Needs login", "Stopped") rather than reading "Connected".
  const warning = row.accounts.find((account) => account.severity === "warning");
  return warning?.transportLabel ?? i18n.t("hub.channels.catalogList.connected");
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
