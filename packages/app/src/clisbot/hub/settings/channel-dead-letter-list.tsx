import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { channelDeadLetterRow, channelIngressStatusLabel } from "../channel-ingress-operations";
import type { ChannelCatalogEntry } from "../channel-catalog";
import type { HubChannelIngressEvent } from "../contracts";

/** Redacted queue rows. The Hub never sends the payload; nothing here asks for it. */
export function ChannelDeadLetterList({
  events,
  catalog,
  selected,
  onToggle,
}: {
  events: readonly HubChannelIngressEvent[];
  catalog: readonly ChannelCatalogEntry[];
  selected: ReadonlySet<string>;
  onToggle(id: string): void;
}) {
  if (events.length === 0) {
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>No dead-lettered events.</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={settingsStyles.card}>
      {events.map((event, index) => (
        <DeadLetterRow
          key={event.id}
          event={event}
          catalog={catalog}
          bordered={index > 0}
          selected={selected.has(event.id)}
          onToggle={onToggle}
        />
      ))}
    </View>
  );
}

function DeadLetterRow({
  event,
  catalog,
  bordered,
  selected,
  onToggle,
}: {
  event: HubChannelIngressEvent;
  catalog: readonly ChannelCatalogEntry[];
  bordered: boolean;
  selected: boolean;
  onToggle(id: string): void;
}) {
  const row = channelDeadLetterRow(event, catalog);
  const toggle = useCallback(() => onToggle(event.id), [event.id, onToggle]);
  const state = useMemo(() => ({ checked: selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={state}
      accessibilityLabel={`${row.title} ${row.conversation}`}
      onPress={toggle}
      style={[
        settingsStyles.row,
        bordered ? settingsStyles.rowBorder : null,
        selected ? styles.selected : null,
      ]}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{row.title}</Text>
        <Text style={settingsStyles.rowHint}>{row.conversation}</Text>
        <Text style={settingsStyles.rowHint}>
          {row.failedAt === null ? row.attempts : `${row.attempts} · ${row.failedAt}`}
        </Text>
        <Text style={settingsStyles.rowError}>{row.reason}</Text>
      </View>
      <StatusBadge
        label={selected ? "Selected" : channelIngressStatusLabel(event.status)}
        variant={selected ? "warning" : "error"}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  selected: {
    backgroundColor: theme.colors.surface2,
  },
}));
