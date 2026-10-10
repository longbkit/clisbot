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
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronLeft, Import } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
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
}: {
  errors: AgentHistoryHostError[];
  connecting?: readonly AgentHistoryHostError[];
  t: TFunction;
}): ReactElement {
  return (
    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="sessions-host-errors">
        {errors.map((error) =>
          connecting.includes(error) ? (
            <Text key={error.serverId} style={styles.connectingText}>
              {error.serverName}: connecting… its sessions appear once it answers.
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
}: {
  errors: AgentHistoryHostError[];
  t: TFunction;
}): ReactElement {
  const statuses = useHostRuntimeConnectionStatuses(
    useMemo(() => errors.map((error) => error.serverId), [errors]),
  );
  const connecting = HOME_V2_ENABLED
    ? errors.filter((error) => isConnecting(statuses.get(error.serverId)))
    : [];
  return <SessionHostErrorsBanner errors={errors} connecting={connecting} t={t} />;
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
  return (
    <View style={styles.filterContainer}>
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
    </View>
  );
}

export function SessionsScreen() {
  return <SessionsScreenContent />;
}

function SessionsScreenContent() {
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
  const showLoadError = isError && agents.length === 0;

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
      <MenuHeader
        title={HOME_V2_ENABLED ? "Inbox" : t("sessions.title")}
        rightContent={importAction}
      />
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
        {hostErrors.length > 0 ? <HostBanners errors={hostErrors} t={t} /> : null}
        {isInitialLoad ? (
          <View style={styles.loadingContainer}>
            <LoadingSpinner size="large" color={theme.colors.foregroundMuted} />
          </View>
        ) : null}
        {!isInitialLoad && showLoadError ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Unable to load sessions</Text>
            <Button variant="ghost" onPress={handleRefresh}>
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
    flexGrow: { xs: 1, md: 0 },
    flexShrink: 1,
    flexBasis: { xs: "100%", md: 320 },
    minWidth: 200,
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
