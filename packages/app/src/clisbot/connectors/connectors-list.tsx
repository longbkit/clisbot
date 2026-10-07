import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { FilterChips } from "../hub/settings/filter-chips";
import { tableStyles } from "../hub/settings/table-styles";
import { ConnectorLogo, serverLogoKey } from "./connector-logo";
import { APP_STATE_LABELS, APP_STATE_VARIANTS, type ConnectorFilter } from "./model";
import type { ConnectorListRow } from "./screen-model";

const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export interface ConnectorsListProps {
  search: string;
  onSearch(value: string): void;
  filter: ConnectorFilter;
  onFilter(value: ConnectorFilter): void;
  counts: { all: number; connected: number; mcp: number };
  sections: { title: string; rows: ConnectorListRow[] }[];
  selected: string | null;
  onSelect(key: string): void;
  /** True until the first catalog page arrives; the list shows a spinner, not "0 apps". */
  loading: boolean;
  footer?: {
    shown: number;
    total?: number;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore(): void;
  };
}

/** The master column: search, the three filters, then apps and servers as rows. */
export function ConnectorsList(props: ConnectorsListProps) {
  const chips = useMemo(
    () =>
      [
        { value: "all", label: "All", count: props.counts.all },
        { value: "connected", label: "Connected", count: props.counts.connected },
        { value: "mcp", label: "MCP servers", count: props.counts.mcp },
      ] as const,
    [props.counts],
  );
  return (
    <View style={styles.column}>
      <SearchField
        value={props.search}
        onChangeText={props.onSearch}
        placeholder="Search apps"
        accessibilityLabel="Search apps"
        clearAccessibilityLabel="Clear search"
        testID="connectors-search"
      />
      <FilterChips chips={chips} value={props.filter} onChange={props.onFilter} />
      {props.loading ? (
        <View style={styles.loading}>
          <ThemedSpinner size="small" />
        </View>
      ) : null}
      {props.loading
        ? null
        : props.sections.map((section) => (
            <View key={section.title} style={styles.section}>
              <Text style={settingsStyles.sectionHeaderTitle}>{section.title}</Text>
              <View style={settingsStyles.card}>
                {section.rows.map((row, index) => (
                  <ConnectorRow
                    key={row.key}
                    row={row}
                    bordered={index > 0}
                    selected={row.key === props.selected}
                    onSelect={props.onSelect}
                  />
                ))}
              </View>
            </View>
          ))}
      {props.footer && !props.loading ? <ListFooter {...props.footer} /> : null}
    </View>
  );
}

function ConnectorRow({
  row,
  bordered,
  selected,
  onSelect,
}: {
  row: ConnectorListRow;
  bordered: boolean;
  selected: boolean;
  onSelect(key: string): void;
}) {
  const press = useCallback(() => onSelect(row.key), [onSelect, row.key]);
  const state = useMemo(() => ({ selected }), [selected]);
  const badge = rowBadge(row.state);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={state}
      onPress={press}
      testID={`connectors-row-${row.key}`}
      style={[
        styles.row,
        bordered ? settingsStyles.rowBorder : null,
        tableStyles.body,
        selected ? tableStyles.selected : null,
      ]}
    >
      <ConnectorLogo
        slug={row.key.startsWith("mcp:") ? serverLogoKey(row.name) : row.slug}
        name={row.name}
        logo={row.logo}
      />
      <Text style={[settingsStyles.rowTitle, styles.name]} numberOfLines={1}>
        {row.name}
      </Text>
      {badge ? <StatusBadge label={badge.label} variant={badge.variant} /> : null}
    </Pressable>
  );
}

function ListFooter({
  shown,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
}: NonNullable<ConnectorsListProps["footer"]>) {
  const count =
    total !== undefined && total > shown
      ? `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} apps`
      : `${shown.toLocaleString()} apps`;
  return (
    <View style={styles.footer}>
      <Text style={settingsStyles.rowHint}>{count}</Text>
      {hasMore ? (
        <Button
          size="xs"
          variant="ghost"
          loading={loadingMore}
          disabled={loadingMore}
          onPress={onLoadMore}
        >
          Load more
        </Button>
      ) : null}
    </View>
  );
}

function rowBadge(
  state: ConnectorListRow["state"],
): { label: string; variant: "success" | "warning" | "error" | "muted" } | null {
  if (state === "server") return { label: "MCP server", variant: "muted" };
  if (state === "server-off") return { label: "Off", variant: "muted" };
  if (state === "none") return null;
  return { label: APP_STATE_LABELS[state], variant: APP_STATE_VARIANTS[state] };
}

const styles = StyleSheet.create((theme) => ({
  // Holds the height of a few rows, so the list does not jump when the page arrives.
  loading: { minHeight: 200, alignItems: "center", justifyContent: "center" },
  column: { gap: theme.spacing[3] },
  section: { gap: theme.spacing[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  name: { flex: 1, minWidth: 0 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
  },
}));
