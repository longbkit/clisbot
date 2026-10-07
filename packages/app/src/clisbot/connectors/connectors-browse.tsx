import { ChevronRight } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ConnectorCatalogItem, ConnectorMcpServer } from "@clisbot/protocol/connectors/types";
import { SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE } from "@/styles/theme";
import { BrowseServersSection as ServersSection } from "./connectors-browse-servers";
import { ConnectorLogo } from "./connector-logo";
import { APP_STATE_LABELS, APP_STATE_VARIANTS, type AppConnectionState } from "./model";

/**
 * The detail pane with nothing selected: connected apps, MCP servers, then the most used apps,
 * each a section of rows in a card (docs/design.md §5, §12). The full catalog is the list beside it.
 */

export const BROWSE_ROW_LIMIT = 12;

const ThemedChevron = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export interface BrowseCard {
  item: ConnectorCatalogItem;
  state: AppConnectionState;
}

export function ConnectorsBrowse({
  connected,
  popular,
  servers,
  onSelect,
  onSelectServer,
  onAddServer,
}: {
  connected: BrowseCard[];
  popular: BrowseCard[];
  servers: ConnectorMcpServer[];
  onSelect(slug: string): void;
  onSelectServer(name: string): void;
  onAddServer(): void;
}) {
  return (
    <View>
      {connected.length > 0 ? (
        <SettingsSection title="Connected" info="Apps with at least one account on this Host.">
          <AppRows cards={connected} onSelect={onSelect} />
        </SettingsSection>
      ) : null}
      <ServersSection servers={servers} onSelect={onSelectServer} onAdd={onAddServer} />
      <SettingsSection
        title="Popular"
        info="Most used across Composio. Search or scroll the list for every app."
      >
        <AppRows cards={popular.slice(0, BROWSE_ROW_LIMIT)} onSelect={onSelect} />
      </SettingsSection>
    </View>
  );
}

function AppRows({ cards, onSelect }: { cards: BrowseCard[]; onSelect(slug: string): void }) {
  return (
    <View style={settingsStyles.card}>
      {cards.map((card, index) => (
        <AppRow key={card.item.slug} card={card} bordered={index > 0} onSelect={onSelect} />
      ))}
    </View>
  );
}

/** One app: logo, name, what it does and its tool count, then its state or Connect. */
function AppRow({
  card,
  bordered,
  onSelect,
}: {
  card: BrowseCard;
  bordered: boolean;
  onSelect(slug: string): void;
}) {
  const { item, state } = card;
  const press = useCallback(() => onSelect(item.slug), [item.slug, onSelect]);
  // The tool count first: a long description is cut at the end of the line.
  const hint = [item.toolsCount ? `${item.toolsCount} tools` : null, item.description]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}${state === "none" ? "" : `, ${APP_STATE_LABELS[state]}`}`}
      onPress={press}
      style={bordered ? rowStyleBordered : rowStyle}
      testID={`connectors-card-${item.slug}`}
    >
      <ConnectorLogo slug={item.slug} name={item.name} logo={item.logo} />
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {item.name}
        </Text>
        {hint ? (
          <Text style={settingsStyles.rowHint} numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Trailing item={item} state={state} onPress={press} />
    </Pressable>
  );
}

function Trailing({
  item,
  state,
  onPress,
}: {
  item: ConnectorCatalogItem;
  state: AppConnectionState;
  onPress(): void;
}) {
  if (state !== "none") {
    return (
      <View style={styles.trailing}>
        <StatusBadge label={APP_STATE_LABELS[state]} variant={APP_STATE_VARIANTS[state]} />
        <ThemedChevron size={ICON_SIZE.sm} />
      </View>
    );
  }
  if (item.noAuth) return <StatusBadge label="No sign-in needed" variant="muted" />;
  return (
    <Button size="sm" variant="outline" onPress={onPress}>
      Connect
    </Button>
  );
}

function rowStyle({ hovered }: { hovered?: boolean }) {
  return [styles.row, hovered ? styles.hovered : null];
}

function rowStyleBordered({ hovered }: { hovered?: boolean }) {
  return [styles.row, settingsStyles.rowBorder, hovered ? styles.hovered : null];
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  hovered: { backgroundColor: theme.colors.surface1 },
  trailing: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
}));
