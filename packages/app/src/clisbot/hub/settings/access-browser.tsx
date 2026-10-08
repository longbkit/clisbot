// People & access › Access as master and detail: the list of people and Teams (or of
// resources) on the left, one entry's grants on the right; on a phone the list,
// then the entry on its own screen. docs/features/access/access-screen.md.

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import { ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import {
  entryFilterChips,
  entryStatus,
  filterEntries,
  hasAccess,
  memberTeamEntries,
  type AccessEntry,
  type EntryFilter,
  type RoleAccess,
} from "./access-browser-model";
import type { GrantGrouping } from "./access-grant-rows";
import { AccessGrantsTable, type GrantActions } from "./access-grants-table";
import { resourceKey, subjectKey } from "./access-catalog";
import { GrantAccessMenu } from "./access-grant-menu";
import { AccessMemberTeams } from "./access-member-teams";
import { BackLink } from "./back-link";
import { DetailHeader } from "./detail-header";
import { FilterChips } from "./filter-chips";
import { tableStyles } from "./table-styles";

const MutedChevron = withUnistyles(ChevronRight, (theme) => ({
  color: theme.colors.foregroundMuted,
  size: 16,
}));

/** Below this width the list and the detail are one screen at a time, as on a phone. */
const SPLIT_MIN_WIDTH = 880;

/** Enough to scan; the rest are one press or a search away. */
const PAGE_SIZE = 50;

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
  const { t } = useTranslation();
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
  const openKey = selectedKey ?? (compact ? null : (entries.find(hasAccess)?.key ?? null));
  const selected = entries.find(({ key }) => key === openKey) ?? null;
  const selectedTeams = useMemo(
    () => (selected === null ? NO_ENTRIES : memberTeamEntries(selected, entries)),
    [entries, selected],
  );
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
      <Text style={styles.muted}>{t("hub.access.browser.chooseEntry")}</Text>
    ) : (
      <EntryDetail
        entry={selected}
        teams={selectedTeams}
        grouping={grouping}
        actions={actions}
        grantTo={grantTo}
        onSelect={onSelect}
      />
    );
  if (compact && selected !== null)
    return (
      <View style={styles.stack} onLayout={measure}>
        <BackLink to={t("hub.access.title")} onPress={back} />
        {detail}
      </View>
    );
  return (
    <View style={styles.stack} onLayout={measure}>
      <ViewByControl grouping={grouping} onChange={changeGrouping} />
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

/** "View access by": the axis the list holds, people and Teams or resources. */
function ViewByControl({
  grouping,
  onChange,
}: {
  grouping: GrantGrouping;
  onChange(grouping: GrantGrouping): void;
}) {
  const { t } = useTranslation();
  const options = useMemo<SegmentedControlOption<GrantGrouping>[]>(
    () => [
      { value: "subject", label: t("hub.access.browser.peopleAndTeams") },
      { value: "resource", label: t("hub.access.browser.resources") },
    ],
    [t],
  );
  return (
    <View style={styles.viewBy}>
      <Text style={styles.viewByLabel}>{t("hub.access.browser.viewBy")}</Text>
      <SegmentedControl options={options} value={grouping} onValueChange={onChange} size="sm" />
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
  const { t } = useTranslation();
  const { filter, search, shown } = list;
  const chips = useMemo(() => entryFilterChips(entries, grouping), [entries, grouping]);
  const visible = useMemo(() => filterEntries(entries, filter, search), [entries, filter, search]);
  const remaining = visible.length - shown;
  return (
    <View style={styles.stack}>
      <SearchField
        value={search}
        onChangeText={list.setSearch}
        placeholder={
          grouping === "subject"
            ? t("hub.access.browser.searchPeople")
            : t("hub.access.browser.searchResources")
        }
        clearAccessibilityLabel={t("hub.access.browser.clearSearch")}
      />
      <FilterChips chips={chips} value={filter} onChange={list.setFilter} />
      <View style={settingsStyles.card}>
        {visible.length === 0 ? (
          <View style={[settingsStyles.row, tableStyles.body]}>
            <Text style={styles.muted}>{t("hub.access.browser.nothingMatches")}</Text>
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
          {t("hub.access.browser.showMore", {
            shown: Math.min(remaining, PAGE_SIZE),
            remaining,
          })}
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
      <Text style={styles.muted}>{entryStatus(entry)}</Text>
      {drillIn ? <MutedChevron /> : null}
    </Pressable>
  );
}

function EntryDetail({
  entry,
  teams,
  grouping,
  actions,
  grantTo,
  onSelect,
}: {
  entry: AccessEntry;
  /** A Member's Teams; empty for anything else. */
  teams: readonly AccessEntry[];
  grouping: GrantGrouping;
  actions: GrantActions;
  grantTo(entry: AccessEntry): void;
  onSelect(key: string): void;
}) {
  const { t } = useTranslation();
  const grant = useCallback(() => grantTo(entry), [entry, grantTo]);
  // A Member in Teams is steered to grant through one of them; see GrantAccessMenu.
  const grantButton = useMemo(
    () =>
      teams.length > 0 ? (
        <GrantAccessMenu
          member={entry}
          teams={teams}
          disabled={actions.pending}
          grantTo={grantTo}
        />
      ) : (
        <Button size="sm" variant="outline" disabled={actions.pending} onPress={grant}>
          {t("hub.access.form.grantAccessEllipsis")}
        </Button>
      ),
    [actions.pending, entry, grant, grantTo, t, teams],
  );
  const rowActions = useMemo<GrantActions>(
    () => ({
      ...actions,
      openVia: onSelect,
      // The same resource, to whoever is on screen, as their own grant.
      grantDirect: (row) =>
        grantTo({
          ...entry,
          target: {
            subject: entry.target.subject ?? subjectKey(row.subject.kind, row.subject.id),
            resource: entry.target.resource ?? resourceKey(row.resource),
          },
        }),
    }),
    [actions, entry, grantTo, onSelect],
  );
  return (
    <View style={styles.stack}>
      {/* An Owner already reaches everything; a grant to them would change nothing. */}
      <DetailHeader
        title={entry.title}
        subtitle={entry.subtitle}
        actions={entry.role === "owner" ? null : grantButton}
      />
      {entry.role === undefined ? null : <Alert {...roleAccessNote(entry.role, t)} />}
      {entry.teamKeys === undefined ? null : (
        <AccessMemberTeams teams={teams} onSelect={onSelect} />
      )}
      <AccessGrantsTable
        rows={entry.rows}
        grouping={grouping}
        empty={emptyGrants(entry, grouping, t)}
        actions={rowActions}
      />
    </View>
  );
}

const NO_ENTRIES: AccessEntry[] = [];

/** What an organization role reaches without a grant, called out over the grants. */
function roleAccessNote(
  role: RoleAccess,
  t: TFunction,
): { variant: "success" | "info"; title: string; description: string } {
  return role === "owner"
    ? {
        variant: "success",
        title: t("hub.access.browser.ownerNoteTitle"),
        description: t("hub.access.browser.ownerNote"),
      }
    : {
        variant: "info",
        title: t("hub.access.browser.adminNoteTitle"),
        description: t("hub.access.browser.adminNote"),
      };
}

/** The empty grants table, worded so it never contradicts the role above it. */
function emptyGrants(entry: AccessEntry, grouping: GrantGrouping, t: TFunction): string {
  if (grouping === "resource") return t("hub.access.browser.emptyResource");
  if (entry.role === "owner") return t("hub.access.browser.emptyOwner");
  if (entry.role === "admin") return t("hub.access.browser.emptyAdmin");
  return t("hub.access.browser.emptyMember");
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
