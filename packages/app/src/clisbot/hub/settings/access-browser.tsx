// People & access › Access as master and detail: the list of people and Teams (or of
// resources) on the left, one entry's grants on the right; on a phone the list,
// then the entry on its own screen. docs/features/access/access-screen.md.

import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import { ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import {
  entryFilterChips,
  filterEntries,
  type AccessEntry,
  type EntryFilter,
} from "./access-browser-model";
import type { GrantGrouping } from "./access-grant-rows";
import { AccessGrantsTable, type GrantActions } from "./access-grants-table";
import { BackLink } from "./back-link";
import { DetailHeader } from "./detail-header";
import { FilterChips } from "./filter-chips";
import { countLabel } from "./labels";
import { tableStyles } from "./table-styles";

const MutedChevron = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundMuted,
  size: 16,
}));

/** Below this width the list and the detail are one screen at a time, as on a phone. */
const SPLIT_MIN_WIDTH = 880;

/** Enough to scan; the rest are one press or a search away. */
const PAGE_SIZE = 50;

const VIEW_OPTIONS: SegmentedControlOption<GrantGrouping>[] = [
  { value: "subject", label: "People and Teams" },
  { value: "resource", label: "Resources" },
];

/**
 * How the list is narrowed right now. It lives above the list, so opening an
 * entry on a phone and coming back keeps the search someone just typed.
 */
interface EntryListState {
  filter: EntryFilter;
  search: string;
  shown: number;
  setFilter(filter: EntryFilter): void;
  setSearch(search: string): void;
  showMore(): void;
  reset(): void;
}

function useEntryListState(): EntryListState {
  const [filter, setChosenFilter] = useState<EntryFilter>("all");
  const [search, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  // Narrowing the list starts it over; otherwise a search lands on page three.
  const setFilter = useCallback((next: EntryFilter) => {
    setChosenFilter(next);
    setShown(PAGE_SIZE);
  }, []);
  const setSearch = useCallback((next: string) => {
    setQuery(next);
    setShown(PAGE_SIZE);
  }, []);
  const showMore = useCallback(() => setShown((current) => current + PAGE_SIZE), []);
  const reset = useCallback(() => {
    setChosenFilter("all");
    setQuery("");
    setShown(PAGE_SIZE);
  }, []);
  return { filter, search, shown, setFilter, setSearch, showMore, reset };
}

export function AccessBrowser({
  entries,
  grouping,
  onGroupingChange,
  selectedKey,
  onSelect,
  actions,
  grantTo,
}: {
  entries: readonly AccessEntry[];
  grouping: GrantGrouping;
  onGroupingChange(grouping: GrantGrouping): void;
  /** The entry open in the detail; null shows the list alone on a phone. */
  selectedKey: string | null;
  onSelect(key: string | null): void;
  actions: GrantActions;
  /** Opens the grant sheet on this entry. */
  grantTo(entry: AccessEntry): void;
}) {
  const list = useEntryListState();
  const compactFormFactor = useIsCompactFormFactor();
  const [width, setWidth] = useState<number | null>(null);
  const measure = useCallback(
    (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
    [],
  );
  // The Settings column, not the window, decides: side by side only when both fit.
  const compact = compactFormFactor || (width !== null && width < SPLIT_MIN_WIDTH);
  // On a wide screen the detail is never empty: the first entry with access opens.
  const openKey =
    selectedKey ?? (compact ? null : (entries.find(({ rows }) => rows.length > 0)?.key ?? null));
  const selected = entries.find(({ key }) => key === openKey) ?? null;
  const back = useCallback(() => onSelect(null), [onSelect]);
  // The other axis lists other things, so its chips and search start over.
  const changeGrouping = useCallback(
    (next: GrantGrouping) => {
      list.reset();
      onGroupingChange(next);
    },
    [list, onGroupingChange],
  );
  const detail =
    selected === null ? (
      <Text style={styles.muted}>Choose someone or something on the left to see its access.</Text>
    ) : (
      <EntryDetail entry={selected} grouping={grouping} actions={actions} grantTo={grantTo} />
    );
  if (compact && selected !== null)
    return (
      <View style={styles.stack} onLayout={measure}>
        <BackLink to="Access" onPress={back} />
        {detail}
      </View>
    );
  return (
    <View style={styles.stack} onLayout={measure}>
      <View style={styles.viewBy}>
        <Text style={styles.viewByLabel}>View access by</Text>
        <SegmentedControl
          options={VIEW_OPTIONS}
          value={grouping}
          onValueChange={changeGrouping}
          size="sm"
        />
      </View>
      <View style={compact ? null : styles.columns}>
        <View style={compact ? null : styles.master}>
          <EntryList
            entries={entries}
            grouping={grouping}
            list={list}
            selectedKey={compact ? null : openKey}
            drillIn={compact}
            onSelect={onSelect}
          />
        </View>
        {compact ? null : <View style={styles.detail}>{detail}</View>}
      </View>
    </View>
  );
}

function EntryList({
  entries,
  grouping,
  list,
  selectedKey,
  drillIn,
  onSelect,
}: {
  entries: readonly AccessEntry[];
  grouping: GrantGrouping;
  list: EntryListState;
  selectedKey: string | null;
  /** The entry opens on its own screen: each row shows it leads somewhere. */
  drillIn: boolean;
  onSelect(key: string): void;
}) {
  const { filter, search, shown } = list;
  const chips = useMemo(() => entryFilterChips(entries, grouping), [entries, grouping]);
  const visible = useMemo(() => filterEntries(entries, filter, search), [entries, filter, search]);
  const remaining = visible.length - shown;
  return (
    <View style={styles.stack}>
      <SearchField
        value={search}
        onChangeText={list.setSearch}
        placeholder={grouping === "subject" ? "Search people and Teams" : "Search resources"}
        clearAccessibilityLabel="Clear Access search"
      />
      <FilterChips chips={chips} value={filter} onChange={list.setFilter} />
      <View style={settingsStyles.card}>
        {visible.length === 0 ? (
          <View style={[settingsStyles.row, tableStyles.body]}>
            <Text style={styles.muted}>Nothing matches.</Text>
          </View>
        ) : (
          visible
            .slice(0, shown)
            .map((entry, index) => (
              <EntryRow
                key={entry.key}
                entry={entry}
                bordered={index > 0}
                selected={entry.key === selectedKey}
                drillIn={drillIn}
                onSelect={onSelect}
              />
            ))
        )}
      </View>
      {remaining > 0 ? (
        <Button size="sm" variant="ghost" onPress={list.showMore}>
          {`Show ${String(Math.min(remaining, PAGE_SIZE))} more of ${String(remaining)}`}
        </Button>
      ) : null}
    </View>
  );
}

function EntryRow({
  entry,
  bordered,
  selected,
  drillIn,
  onSelect,
}: {
  entry: AccessEntry;
  bordered: boolean;
  selected: boolean;
  drillIn: boolean;
  onSelect(key: string): void;
}) {
  const press = useCallback(() => onSelect(entry.key), [entry.key, onSelect]);
  const state = useMemo(() => ({ selected }), [selected]);
  const style = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      bordered ? settingsStyles.rowBorder : null,
      tableStyles.body,
      Boolean(hovered) && !selected ? tableStyles.hovered : null,
      selected ? tableStyles.selected : null,
      styles.entry,
    ],
    [bordered, selected],
  );
  const grants = entry.rows.length;
  return (
    <Pressable accessibilityRole="button" accessibilityState={state} onPress={press} style={style}>
      <View style={styles.entryText}>
        <Text style={styles.title} numberOfLines={1}>
          {entry.title}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {entry.subtitle}
        </Text>
      </View>
      <Text style={styles.muted}>{grants === 0 ? "No access" : countLabel(grants, "grant")}</Text>
      {drillIn ? <MutedChevron /> : null}
    </Pressable>
  );
}

function EntryDetail({
  entry,
  grouping,
  actions,
  grantTo,
}: {
  entry: AccessEntry;
  grouping: GrantGrouping;
  actions: GrantActions;
  grantTo(entry: AccessEntry): void;
}) {
  const grant = useCallback(() => grantTo(entry), [entry, grantTo]);
  const grantButton = useMemo(
    () => (
      <Button size="sm" variant="outline" disabled={actions.pending} onPress={grant}>
        Grant access…
      </Button>
    ),
    [actions.pending, grant],
  );
  return (
    <View style={styles.stack}>
      <DetailHeader title={entry.title} subtitle={entry.subtitle} actions={grantButton} />
      <AccessGrantsTable
        rows={entry.rows}
        grouping={grouping}
        empty={
          grouping === "subject"
            ? "No access yet. Grant some, or add them to a Team that has it."
            : "No one has access yet, other than Owners."
        }
        actions={actions}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: { gap: theme.spacing[3] },
  viewBy: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.spacing[3] },
  viewByLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[6] },
  master: { flexBasis: 340, flexShrink: 0 },
  detail: { flex: 1, minWidth: 0 },
  entry: { gap: theme.spacing[3] },
  entryText: { flex: 1, minWidth: 0, gap: theme.spacing[0.5] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
}));
