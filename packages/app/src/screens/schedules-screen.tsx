import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { ScrollView, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { CalendarClock, Plus } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { ExternalLink } from "@/components/ui/external-link";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import { ScheduleFormSheet } from "@/components/schedules/schedule-form-sheet";
import { SchedulesTable, type ScheduleRowView } from "@/components/schedules/schedules-table";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useProjects } from "@/hooks/use-projects";
import {
  useSchedules,
  type AggregateLoadState,
  type AggregatedSchedule,
  type ScheduleHostError,
} from "@/hooks/use-schedules";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  resolveSchedule,
  type ScheduleBucket,
  type ScheduleTargetAgent,
} from "@/schedules/schedule-derivation";
import { resolveSchedulesScreenBodyState } from "./schedules-screen-state";
import {
  buildProjectNameByCwd,
  buildScheduleProjectTargets,
} from "@/schedules/schedule-project-targets";
import type { ScheduleSummary } from "@clisbot/protocol/schedule/types";
import { ScheduleDetailSheet } from "@/clisbot/schedules/schedule-detail-sheet";
import { useCanCreateSchedules } from "@/clisbot/schedules/use-schedule-detail";
import { navigateToAgent } from "@/utils/navigate-to-agent";

type FormState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; serverId: string; schedule: ScheduleSummary };

const STATUS_FILTER_OPTIONS: { value: ScheduleBucket; label: string; testID: string }[] = [
  { value: "runnable", label: "Active", testID: "schedules-filter-active" },
  { value: "ended", label: "Ended", testID: "schedules-filter-ended" },
];

const EMPTY_SCHEDULES: AggregatedSchedule[] = [];

export function SchedulesScreen(): ReactElement {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <SchedulesScreenContent />;
}

export function SchedulesScreenContent({
  embedded = false,
}: { embedded?: boolean } = {}): ReactElement {
  const { loadState, hostErrors, isError, refetch } = useSchedules();
  const schedules = loadState.status === "loaded" ? loadState.data : EMPTY_SCHEDULES;
  const { agents } = useAggregatedAgents({ includeArchived: true });
  const { projects } = useProjects();
  const hosts = useAvailableHosts();
  const runtime = getHostRuntimeStore();
  const runtimeVersion = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );

  // Per-host agent-directory readiness from the runtime, not the aggregate agent
  // flag: the aggregate `isInitialLoad` flips false as soon as *any* host has
  // agents, so a still-loading host would falsely mark its agent-target
  // schedules "gone". `hasEverLoadedAgentDirectory` is true only once that
  // host's directory has loaded at least once.
  const agentDirReadyHosts = useMemo(() => {
    void runtimeVersion;
    const ready = new Set<string>();
    for (const host of hosts) {
      if (runtime.getSnapshot(host.serverId)?.hasEverLoadedAgentDirectory) {
        ready.add(host.serverId);
      }
    }
    return ready;
  }, [hosts, runtime, runtimeVersion]);

  const [form, setForm] = useState<FormState>({ mode: "closed" });
  const [selectedHost, setSelectedHost] = useState(ALL_HOSTS_OPTION_ID);
  const [statusFilter, setStatusFilter] = useState<ScheduleBucket>("runnable");

  useEffect(() => {
    if (
      selectedHost !== ALL_HOSTS_OPTION_ID &&
      !hosts.some((host) => host.serverId === selectedHost)
    ) {
      setSelectedHost(ALL_HOSTS_OPTION_ID);
    }
  }, [hosts, selectedHost]);

  const openCreate = useCallback(() => setForm({ mode: "create" }), []);
  // Clisbot Managed Access: New schedule only where some host grants `schedule.manage`.
  const canCreate = useCanCreateSchedules();
  const closeForm = useCallback(() => setForm({ mode: "closed" }), []);
  // Clisbot: a row opens the shared detail sheet; its More settings opens the form.
  const [detail, setDetail] = useState<{ serverId: string; scheduleId: string } | null>(null);
  const openDetail = useCallback((schedule: AggregatedSchedule) => {
    setDetail({ serverId: schedule.serverId, scheduleId: schedule.id });
  }, []);
  const closeDetail = useCallback(() => setDetail(null), []);
  const editSettings = useCallback(
    (schedule: ScheduleSummary) => {
      if (!detail) return;
      setDetail(null);
      setForm({ mode: "edit", serverId: detail.serverId, schedule });
    },
    [detail],
  );
  const openAgent = useCallback(
    (agentId: string) => {
      if (detail) navigateToAgent({ serverId: detail.serverId, agentId });
    },
    [detail],
  );

  const agentsByKey = useMemo(() => {
    const map = new Map<string, ScheduleTargetAgent>();
    for (const agent of agents) {
      map.set(`${agent.serverId}:${agent.id}`, { title: agent.title, provider: agent.provider });
    }
    return map;
  }, [agents]);

  const projectNameByCwd = useMemo(
    () => buildProjectNameByCwd(buildScheduleProjectTargets(projects)),
    [projects],
  );

  // Resolve every schedule's derived state and target line once, then partition
  // by the host and status filters. Sorted newest-first for a stable order
  // across hosts.
  const resolvedRows = useMemo(() => {
    const now = Date.now();
    return schedules.map((schedule) => ({
      schedule,
      resolved: resolveSchedule({
        schedule,
        serverId: schedule.serverId,
        now,
        agentsByKey,
        projectNameByCwd,
        agentDataLoaded: agentDirReadyHosts.has(schedule.serverId),
      }),
    }));
  }, [schedules, agentsByKey, projectNameByCwd, agentDirReadyHosts]);

  const visibleRows = useMemo<ScheduleRowView[]>(() => {
    const singleHost = hosts.length <= 1;
    return resolvedRows
      .filter(
        ({ schedule, resolved }) =>
          (selectedHost === ALL_HOSTS_OPTION_ID || schedule.serverId === selectedHost) &&
          resolved.bucket === statusFilter,
      )
      .sort((a, b) => Date.parse(b.schedule.createdAt) - Date.parse(a.schedule.createdAt))
      .map(({ schedule, resolved }) => ({
        schedule,
        targetLabel: resolved.target.label,
        provider: resolved.target.provider,
        state: resolved.state,
        serverName: schedule.serverName,
        singleHost,
      }));
  }, [resolvedRows, selectedHost, statusFilter, hosts.length]);

  const showLoadError = isError && loadState.status !== "loaded";
  const showHostFilter = hosts.length > 1;

  return (
    <View style={styles.container}>
      {!embedded ? <MenuHeader title="Schedules" /> : null}
      <SchedulesScreenBody
        rows={visibleRows}
        loadState={loadState}
        hostErrors={hostErrors}
        showLoadError={showLoadError}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        showHostFilter={showHostFilter}
        hosts={hosts}
        selectedHost={selectedHost}
        onSelectHost={setSelectedHost}
        onRetry={refetch}
        onCreate={canCreate ? openCreate : undefined}
        onEdit={openDetail}
      />
      {detail ? (
        <ScheduleDetailSheet
          serverId={detail.serverId}
          scheduleId={detail.scheduleId}
          onClose={closeDetail}
          onOpenAgent={openAgent}
          onEditSettings={editSettings}
        />
      ) : null}
      <ScheduleFormSheet
        serverId={form.mode === "edit" ? form.serverId : undefined}
        visible={form.mode === "create" || form.mode === "edit"}
        onClose={closeForm}
        mode={form.mode === "edit" ? "edit" : "create"}
        schedule={form.mode === "edit" ? form.schedule : undefined}
      />
    </View>
  );
}

function SchedulesScreenBody({
  rows,
  loadState,
  hostErrors,
  showLoadError,
  statusFilter,
  onStatusFilterChange,
  showHostFilter,
  hosts,
  selectedHost,
  onSelectHost,
  onRetry,
  onCreate,
  onEdit,
}: {
  rows: ScheduleRowView[];
  loadState: AggregateLoadState<AggregatedSchedule>;
  hostErrors: ScheduleHostError[];
  showLoadError: boolean;
  statusFilter: ScheduleBucket;
  onStatusFilterChange: (value: ScheduleBucket) => void;
  showHostFilter: boolean;
  hosts: ReturnType<typeof useAvailableHosts>;
  selectedHost: string;
  onSelectHost: (serverId: string) => void;
  onRetry: () => void;
  onCreate?: () => void;
  onEdit: (schedule: AggregatedSchedule) => void;
}): ReactElement {
  const bodyState = resolveSchedulesScreenBodyState({ loadState, showLoadError });

  if (bodyState.kind === "loading") {
    return (
      <View style={styles.centered}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
      </View>
    );
  }

  if (bodyState.kind === "load-error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Unable to load schedules</Text>
        <Button variant="ghost" onPress={onRetry} testID="schedules-retry">
          Try again
        </Button>
      </View>
    );
  }

  if (bodyState.kind === "empty") {
    return (
      <View style={styles.centered}>
        {hostErrors.length > 0 ? <ScheduleHostErrorsBanner errors={hostErrors} /> : null}
        <SchedulesEmptyState onCreate={onCreate} testID="schedules-empty" />
      </View>
    );
  }

  let schedulesContent: ReactElement;
  if (rows.length > 0) {
    schedulesContent = <SchedulesTable rows={rows} onEditSchedule={onEdit} />;
  } else if (statusFilter === "ended") {
    schedulesContent = <SchedulesEndedEmptyState />;
  } else {
    schedulesContent = (
      <View style={styles.filterEmpty}>
        <SchedulesEmptyState onCreate={onCreate} testID="schedules-empty" />
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <View style={styles.filterRow}>
        <View style={styles.filterRowControls}>
          {showHostFilter ? (
            <HostFilter
              hosts={hosts}
              selectedHost={selectedHost}
              onSelectHost={onSelectHost}
              triggerTestID="schedules-host-filter-trigger"
            />
          ) : null}
          <SegmentedControl
            size="sm"
            value={statusFilter}
            onValueChange={onStatusFilterChange}
            options={STATUS_FILTER_OPTIONS}
            testID="schedules-status-filter"
          />
        </View>
        {onCreate ? (
          <Button
            variant="outline"
            leftIcon={Plus}
            onPress={onCreate}
            size="sm"
            testID="schedules-new"
          >
            New schedule
          </Button>
        ) : null}
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        testID="schedules-list"
      >
        {hostErrors.length > 0 ? <ScheduleHostErrorsBanner errors={hostErrors} /> : null}
        {schedulesContent}
      </ScrollView>
    </View>
  );
}

function SchedulesEmptyState({
  onCreate,
  testID,
}: {
  onCreate?: () => void;
  testID?: string;
}): ReactElement {
  return (
    <View style={styles.emptyState} testID={testID}>
      <CalendarClock size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
      <View style={styles.emptyTextStack}>
        <Text style={styles.emptyTitle}>No active schedules</Text>
        <Text style={styles.emptyDescription}>Schedules run agents on a cadence.</Text>
        <ExternalLink href="https://clisbot.com/docs/schedules" label="See docs" />
      </View>
      {onCreate ? (
        <Button variant="outline" leftIcon={Plus} onPress={onCreate} testID="schedules-empty-new">
          New schedule
        </Button>
      ) : null}
    </View>
  );
}

function SchedulesEndedEmptyState(): ReactElement {
  return (
    <View style={styles.filterEmpty}>
      <View style={styles.endedEmptyState}>
        <CalendarClock size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
        <Text style={styles.emptyTitle}>No ended schedules</Text>
      </View>
    </View>
  );
}

function ScheduleHostErrorsBanner({ errors }: { errors: ScheduleHostError[] }): ReactElement {
  return (
    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="schedules-host-errors">
        {errors.map((error) => (
          <Text key={error.serverId} style={styles.errorsBannerText}>
            {`${error.serverName}: Could not load schedules`}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[4],
  },
  filterRowControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    flexShrink: 1,
    flexWrap: "wrap",
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
    gap: theme.spacing[3],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  errorsBannerWrap: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
  },
  errorsBanner: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  errorsBannerText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  filterEmpty: {
    flexGrow: 1,
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[6],
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    gap: theme.spacing[4],
    maxWidth: 420,
    width: "100%",
  },
  endedEmptyState: {
    alignItems: "center",
    gap: theme.spacing[3],
  },
  emptyTextStack: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  // Static color holder read by the spinner; keeps the muted token without
  // useUnistyles (banned in new code).
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  emptyIcon: {
    color: theme.colors.foregroundMuted,
    width: theme.iconSize.lg,
  },
}));
