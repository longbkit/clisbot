import { HOME_V2_ENABLED } from "@/clisbot/home/feature";
import { useInboxFilters, mergeInboxAgents } from "@/clisbot/home/inbox-filters";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  type ReactElement,
  type ReactNode,
} from "react";
import { View, Text } from "react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronLeft, Import } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { MIN_TOUCH_TARGET_SIZE } from "@/components/ui/control-geometry";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { AgentList } from "@/components/agent-list";
import { SearchField } from "@/components/ui/search-field";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import { type AgentHistoryHostError, useAgentHistory } from "@/hooks/use-agent-history";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useImportSession } from "@/hooks/use-import-session";
import { useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import { buildOpenProjectRoute } from "@/utils/host-routes";

/** Long enough that a typed word is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 200;

const sessionsHostOptionTestID = (serverId: string) => `sessions-host-filter-item-${serverId}`;

/**
 * A host that failed while others answered. Without this the list silently
 * under-reports, and under a query "No sessions match" becomes a claim the app
 * has no basis for.
 */
function SessionHostErrorsBanner({
  errors,
  connecting = [],
  t,
  testID = "sessions-host-errors",
}: {
  errors: AgentHistoryHostError[];
  connecting?: readonly AgentHistoryHostError[];
  t: TFunction;
  testID?: string;
}): ReactElement {
  return (
    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID={testID}>
        {errors.map((error) =>
          connecting.includes(error) ? (
            <Text key={error.serverId} style={styles.connectingText}>
              {error.serverName}: connecting… showing saved sessions when available.
            </Text>
          ) : (
            <Text key={error.serverId} style={styles.errorsBannerText}>
              {t("sessions.hostLoadFailed", { host: error.serverName })}
            </Text>
          ),
        )}
      </View>
    </View>
  );
}

/** An empty list means something different once a query is narrowing it. */
function resolveEmptyText(input: {
  t: TFunction;
  isSearching: boolean;
  isAllHosts: boolean;
}): string {
  if (input.isSearching) return input.t("sessions.noMatches");
  if (input.isAllHosts) return input.t("sessions.empty");
  return "No sessions for this host";
}

function isConnecting(status: string | undefined): boolean {
  return status === undefined || status === "connecting" || status === "idle";
}

/**
 * Names every Host missing from the list. One still connecting reads as that, not as a
 * failure: History used to show "Could not load history" on every cold start.
 */
function HostBanners({
  errors,
  t,
  loading,
  refreshing,
  onRetry,
}: {
  errors: AgentHistoryHostError[];
  t: TFunction;
  loading: boolean;
  refreshing: boolean;
  onRetry: () => void;
}): ReactElement {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const openDetails = useCallback(() => setDetailsOpen(true), []);
  const closeDetails = useCallback(() => setDetailsOpen(false), []);
  const statuses = useHostRuntimeConnectionStatuses(
    useMemo(() => errors.map((error) => error.serverId), [errors]),
  );
  const connecting = HOME_V2_ENABLED
    ? errors.filter((error) => isConnecting(statuses.get(error.serverId)))
    : [];
  const sheetHeader = useMemo(() => ({ title: t("sessions.title") }), [t]);
  const sheetFooter = useMemo(
    () => (
      <Button variant="outline" onPress={onRetry} disabled={loading || refreshing}>
        Try again
      </Button>
    ),
    [loading, onRetry, refreshing],
  );
  if (!HOME_V2_ENABLED) return <SessionHostErrorsBanner errors={errors} t={t} />;
  let message = t("sessions.title");
  if (refreshing) message = "Refreshing history…";
  if (loading) message = "Loading history…";
  if (errors.length)
    message = errors
      .map((error) =>
        connecting.includes(error)
          ? `${error.serverName}: connecting…`
          : t("sessions.hostLoadFailed", { host: error.serverName }),
      )
      .join("; ");
  return (
    <>
      <View style={styles.historyStatus}>
        <Text
          testID={errors.length ? "sessions-host-errors" : undefined}
          style={[styles.historyStatusText, errors.length > 0 && styles.errorsBannerText]}
          numberOfLines={1}
          accessibilityLabel={message}
        >
          {message}
        </Text>
        {errors.length > 0 ? (
          <Button variant="ghost" size="xs" onPress={openDetails}>
            Details
          </Button>
        ) : null}
      </View>
      <AdaptiveModalSheet
        visible={detailsOpen}
        onClose={closeDetails}
        header={sheetHeader}
        footer={sheetFooter}
      >
        <SessionHostErrorsBanner
          errors={errors}
          connecting={connecting}
          t={t}
          testID="sessions-host-error-details"
        />
      </AdaptiveModalSheet>
    </>
  );
}

/** Search, Host and (in Inbox) the type/date pills, on one wrapping row. */
function SessionsFilterRow({
  hosts,
  selectedHost,
  onSelectHost,
  isSearchSupported,
  searchInput,
  onChangeSearch,
  extra,
  t,
}: {
  hosts: ReturnType<typeof useAvailableHosts>;
  selectedHost: string;
  onSelectHost: (serverId: string) => void;
  isSearchSupported: boolean;
  searchInput: string;
  onChangeSearch: (value: string) => void;
  extra: ReactNode;
  t: TFunction;
}): ReactElement | null {
  const showHostFilter = hosts.length > 1;
  if (!showHostFilter && !isSearchSupported && !extra) return null;
  const pills = (
    <>
      {showHostFilter ? (
        <HostFilter
          hosts={hosts}
          selectedHost={selectedHost}
          onSelectHost={onSelectHost}
          triggerTestID="sessions-host-filter-trigger"
          hostOptionTestID={sessionsHostOptionTestID}
        />
      ) : null}
      {extra}
    </>
  );
  return (
    <View style={[styles.filterContainer, HOME_V2_ENABLED && styles.inboxFilters]}>
      {isSearchSupported ? (
        <View style={HOME_V2_ENABLED ? styles.searchWrap : styles.searchWrapLegacy}>
          <SearchField
            value={searchInput}
            onChangeText={onChangeSearch}
            placeholder={HOME_V2_ENABLED ? "Search conversations" : t("sessions.searchPlaceholder")}
            clearAccessibilityLabel={t("sessions.actions.clearSearch")}
            testID="sessions-search-input"
            clearTestID="sessions-search-clear"
          />
        </View>
      ) : null}
      {HOME_V2_ENABLED ? <View style={styles.filterPills}>{pills}</View> : pills}
    </View>
  );
}

/** Inbox's own header; Home's embedded history sits under Home's. */
function SessionsHeader({
  embedded,
  rightContent,
}: {
  embedded: boolean;
  rightContent: ReactNode;
}) {
  const { t } = useTranslation();
  if (embedded) return null;
  return (
    <MenuHeader
      title={HOME_V2_ENABLED ? "Inbox" : t("sessions.title")}
      rightContent={rightContent}
    />
  );
}

export function SessionsScreen() {
  return <SessionsScreenContent />;
}

/** Navigation V2 Home's search: Inbox's history, filters and Load more, under Home's header. */
export function InboxHistory() {
  return (
    <View style={styles.fill} testID="home-history">
      <SessionsScreenContent embedded />
    </View>
  );
}

function SessionsScreenContent({ embedded = false }: { embedded?: boolean }) {
  const focused = useIsFocused();
  const live = useAggregatedAgents({ demand: focused });
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const importSession = useImportSession();
  const hosts = useAvailableHosts();
  const [selectedHost, setSelectedHost] = useState(ALL_HOSTS_OPTION_ID);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS).trim();
  const historyServerId = selectedHost === ALL_HOSTS_OPTION_ID ? null : selectedHost;
  const filters = useInboxFilters(
    hosts
      .filter((host) => !historyServerId || host.serverId === historyServerId)
      .map((host) => host.serverId),
  );
  const {
    agents,
    hasMore,
    isInitialLoad,
    isLoadingMore,
    isRevalidating,
    isError,
    isSearchSupported,
    isSearchTruncated,
    hostErrors,
    loadMore,
    refreshAll,
  } = useAgentHistory({
    serverId: historyServerId,
    search,
    activityFilter: HOME_V2_ENABLED ? filters.activityFilter : undefined,
  });
  const inboxAgents = useMemo(
    () =>
      HOME_V2_ENABLED
        ? mergeInboxAgents(
            agents,
            live.agents,
            historyServerId,
            search,
            Boolean(filters.activityFilter?.kind || filters.activityFilter?.updatedAfter),
          )
        : agents,
    [agents, live.agents, historyServerId, search, filters.activityFilter],
  );
  const isSearching = isSearchSupported && search.length > 0;

  useEffect(() => {
    if (
      selectedHost !== ALL_HOSTS_OPTION_ID &&
      !hosts.some((host) => host.serverId === selectedHost)
    ) {
      setSelectedHost(ALL_HOSTS_OPTION_ID);
    }
  }, [hosts, selectedHost]);

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    void refreshAll().finally(() => setIsManualRefresh(false));
  }, [refreshAll]);

  // Searching filters the chronological history without changing its date buckets.
  const emptyText = resolveEmptyText({
    t,
    isSearching,
    isAllHosts: selectedHost === ALL_HOSTS_OPTION_ID,
  });
  const showLoadError = (isError || hostErrors.length > 0) && inboxAgents.length === 0;

  const handleBack = useCallback(() => {
    router.navigate(buildOpenProjectRoute());
  }, []);

  const handleClearSearch = useCallback(() => setSearchInput(""), []);

  const listFooterComponent = useMemo(() => {
    // COMPAT(historyPagination): old daemons return a truncated relevance page.
    // Added in v0.8.0; remove after 2027-03-16 once the daemon floor supports search pagination.
    if (isSearchTruncated) {
      return (
        <View style={styles.footer}>
          <Text style={styles.footerHint}>{t("sessions.tooManyMatches")}</Text>
        </View>
      );
    }
    if (!hasMore) {
      return null;
    }
    return (
      <View style={styles.footer}>
        <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? "Loading..." : t("sessions.actions.loadMore")}
        </Button>
      </View>
    );
  }, [hasMore, isLoadingMore, isSearchTruncated, loadMore, t]);

  const importAction = useMemo(
    () => (
      <Button variant="ghost" onPress={importSession.open}>
        Import session
      </Button>
    ),
    [importSession.open],
  );
  const emptyView = useMemo(
    () =>
      !isInitialLoad && !showLoadError && inboxAgents.length === 0 ? (
        <View style={styles.emptyContainer} testID="sessions-empty">
          <Text style={styles.emptyText}>{emptyText}</Text>
          {hasMore ? listFooterComponent : null}
          {isSearching ? (
            <Button variant="ghost" onPress={handleClearSearch}>
              {t("sessions.actions.clearSearch")}
            </Button>
          ) : (
            <Button variant="ghost" leftIcon={ChevronLeft} onPress={handleBack}>
              Back
            </Button>
          )}
          <Button variant="ghost" leftIcon={Import} onPress={importSession.open}>
            {t("importSession.title")}
          </Button>
        </View>
      ) : null,
    [
      isInitialLoad,
      showLoadError,
      inboxAgents.length,
      emptyText,
      hasMore,
      listFooterComponent,
      isSearching,
      handleClearSearch,
      t,
      handleBack,
      importSession.open,
    ],
  );
  return (
    <View style={styles.container}>
      <SessionsHeader embedded={embedded} rightContent={importAction} />
      <View style={HOME_V2_ENABLED ? styles.body : styles.fill}>
        <SessionsFilterRow
          hosts={hosts}
          selectedHost={selectedHost}
          onSelectHost={setSelectedHost}
          isSearchSupported={isSearchSupported}
          searchInput={searchInput}
          onChangeSearch={setSearchInput}
          extra={HOME_V2_ENABLED ? filters.view : null}
          t={t}
        />
        {HOME_V2_ENABLED || hostErrors.length > 0 ? (
          <HostBanners
            errors={hostErrors}
            t={t}
            loading={isInitialLoad}
            refreshing={isRevalidating || isManualRefresh}
            onRetry={handleRefresh}
          />
        ) : null}
        {isInitialLoad ? (
          <View style={styles.loadingContainer}>
            <LoadingSpinner size="large" color={theme.colors.foregroundMuted} />
          </View>
        ) : null}
        {!isInitialLoad && showLoadError ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Unable to load sessions</Text>
            <Button variant="ghost" onPress={handleRefresh} disabled={isManualRefresh}>
              Try again
            </Button>
          </View>
        ) : null}
        {emptyView}
        {!isInitialLoad && !showLoadError && inboxAgents.length > 0 ? (
          <AgentList
            agents={inboxAgents}
            activityGrouping={HOME_V2_ENABLED}
            showCheckoutInfo={false}
            isRefreshing={isManualRefresh}
            onRefresh={handleRefresh}
            listFooterComponent={listFooterComponent}
            showAttentionIndicator={false}
            showHostColumn={!HOME_V2_ENABLED || hosts.length > 1}
            search={isSearching ? search : undefined}
          />
        ) : null}
      </View>
      {importSession.sheet}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  historyStatus: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
  },
  historyStatusText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  filterContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[4],
  },
  inboxFilters: {
    flexDirection: { xs: "column", md: "row" },
    alignItems: "stretch",
    flexShrink: 0,
    paddingBottom: theme.spacing[3],
  },
  filterPills: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
    flexShrink: 0,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  footer: {
    alignItems: "center",
    paddingVertical: theme.spacing[4],
  },
  footerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  fill: { flex: 1 },
  // On a phone the search takes its own row and the filter pills wrap under it.
  // A fixed width short of SearchField's own cap keeps search, Host, Type and Date on one row.
  searchWrap: {
    flexDirection: "row",
    width: { xs: "100%", md: 320 },
    minWidth: 0,
    flexShrink: 0,
  },
  searchWrapLegacy: { flex: 1 },
  // Inbox rows read as one line of meaning; a reading-width column keeps time and status near it.
  body: { flex: 1, width: "100%", maxWidth: theme.contentMaxWidth, alignSelf: "center" },
  connectingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorsBannerWrap: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[3],
  },
  errorsBanner: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  errorsBannerText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
}));
