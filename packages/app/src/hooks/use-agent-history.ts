import type {
  DaemonClient,
  FetchAgentHistoryOptions,
  FetchAgentHistoryPageInfo,
} from "@clisbot/client/internal/daemon-client";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { buildAgentDirectoryState } from "@/utils/agent-directory-sync";
import { agentHistoryQueryKey, allAgentHistoryQueryKey } from "./agent-history-query-key";

const AGENT_HISTORY_PAGE_LIMIT = 200;
const AGENT_HISTORY_SORT: NonNullable<FetchAgentHistoryOptions["sort"]> = [
  { key: "updated_at", direction: "desc" },
];
const AGENT_HISTORY_ALL_HOSTS_FAILED_MESSAGE = "No connected hosts could load agent history";
/** A Host slower than this does not hold the page; its rows merge in when they arrive. */
export const AGENT_HISTORY_SOURCE_TIMEOUT_MS = 5_000;

export interface AgentHistoryResult {
  agents: AggregatedAgent[];
  isLoading: boolean;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isError: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  /** False when any target host predates search; the screen hides the field. */
  isSearchSupported: boolean;
  /** More sessions matched than the ranked page holds. Narrow the query. */
  isSearchTruncated: boolean;
  /** Hosts that failed while others succeeded. The list still renders. */
  hostErrors: AgentHistoryHostError[];
  /** Hosts still answering after the page was shown; their sessions merge in when they do. */
  lateHosts: AgentHistoryHostError[];
  refreshAll: () => Promise<void>;
  loadMore: () => void;
}

export interface AgentHistoryPage {
  agents: AggregatedAgent[];
  pageInfo: FetchAgentHistoryPageInfo;
  /** More matched this host's query than its page could hold. */
  isSearchTruncated: boolean;
}

export type AgentHistoryClient = Pick<DaemonClient, "fetchAgentHistory">;

/**
 * A host that could not be reached while at least one other could. Its sessions
 * are missing from the list, which under a query means "no matches" would be a
 * claim the app cannot make.
 */
export interface AgentHistoryHostError {
  serverId: string;
  serverName: string;
}

export interface AgentHistoryHost {
  serverId: string;
  serverLabel: string;
  client: AgentHistoryClient;
}

interface AgentHistoryBatchPage {
  agents: AggregatedAgent[];
  pageInfoByServerId: Record<string, FetchAgentHistoryPageInfo>;
  hostErrors: AgentHistoryHostError[];
  /** Set only under a query: more sessions matched than this page can hold. */
  isSearchTruncated?: boolean;
  /** Hosts that missed the per-source deadline and are still answering. */
  lateHosts?: AgentHistoryHostError[];
  /** Identifies the fetch that built this page, so a late answer merges only into it. */
  fetchId?: string;
}

export type LateAgentHistoryResult =
  | { host: AgentHistoryHost; page: AgentHistoryPage }
  | { host: AgentHistoryHost; error: unknown };

type AgentHistoryCursorByServerId = Record<string, string | null>;

/** Keep accepted pages only for the members this request could not revalidate. The existing
 * query cache supplies them, so another search/filter/Host selection cannot donate results. */
export function retainUnavailableHostHistory(input: {
  page: AgentHistoryBatchPage;
  cursorByServerId: AgentHistoryCursorByServerId | null;
  accepted?: InfiniteData<AgentHistoryBatchPage, AgentHistoryCursorByServerId | null>;
  unavailableHostIds: ReadonlySet<string>;
}): AgentHistoryBatchPage {
  if (!input.accepted || !input.unavailableHostIds.size) return input.page;
  const retained: AggregatedAgent[] = [];
  for (const serverId of input.unavailableHostIds) {
    if (input.cursorByServerId && !Object.hasOwn(input.cursorByServerId, serverId)) continue;
    const cursor = input.cursorByServerId?.[serverId];
    const matchingPages = input.accepted.pages.filter(
      (_, index) => input.accepted?.pageParams[index]?.[serverId] === cursor,
    );
    // A first-page failure keeps every already loaded page of that Host. A later-page
    // failure uses its accepted cursor page, or the accepted tail if a fresh cursor changed.
    const pages =
      input.cursorByServerId && matchingPages.length ? matchingPages : input.accepted.pages;
    for (const page of pages)
      retained.push(...page.agents.filter((agent) => agent.serverId === serverId));
  }
  if (!retained.length) return input.page;
  return {
    ...input.page,
    agents: sortByLatestActivity([...input.page.agents, ...retained]),
  };
}

export async function fetchAgentHistoryPage(input: {
  client: AgentHistoryClient;
  serverId: string;
  cursor: string | null;
  search?: string;
  activityFilter?: FetchAgentHistoryOptions["activityFilter"];
}): Promise<AgentHistoryPage> {
  const payload = await input.client.fetchAgentHistory({
    ...(input.search ? { search: input.search } : {}),
    ...(input.activityFilter ? { activityFilter: input.activityFilter } : {}),
    sort: AGENT_HISTORY_SORT,
    page: input.cursor
      ? { limit: AGENT_HISTORY_PAGE_LIMIT, cursor: input.cursor }
      : { limit: AGENT_HISTORY_PAGE_LIMIT },
  });

  const { agents } = buildAgentDirectoryState({
    serverId: input.serverId,
    entries: payload.entries,
  });
  return {
    isSearchTruncated: payload.searchTruncated === true,
    agents: Array.from(agents.values(), (agent) => ({
      id: agent.id,
      serverId: input.serverId,
      serverLabel: input.serverId,
      title: agent.title ?? null,
      status: agent.status,
      turn: agent.turn,
      lastActivityAt: agent.lastActivityAt,
      cwd: agent.cwd,
      workspaceId: agent.workspaceId,
      provider: agent.provider,
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
      attentionTimestamp: agent.attentionTimestamp ?? null,
      archivedAt: agent.archivedAt ?? null,
      createdAt: agent.createdAt,
      labels: agent.labels,
      projectPlacement: agent.projectPlacement,
    })),
    pageInfo: payload.pageInfo,
  };
}

function sortByLatestActivity(agents: AggregatedAgent[]): AggregatedAgent[] {
  return [...agents].sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
}

/**
 * Which hosts are missing from the list the user is looking at.
 *
 * Failures are collected across every loaded page, not just the newest: a host
 * that rejects page one contributes no cursor and is never asked again, so a
 * later page carries no error of its own while that host's history is still
 * absent. A refetch replaces every page, which is what clears an error that has
 * healed.
 */
export function collectAgentHistoryHostErrors(input: {
  pages: readonly Pick<AgentHistoryBatchPage, "hostErrors">[];
  unreachableHosts: readonly AgentHistoryHostError[];
}): AgentHistoryHostError[] {
  const byServerId = new Map<string, AgentHistoryHostError>();
  for (const error of input.unreachableHosts) {
    byServerId.set(error.serverId, error);
  }
  for (const page of input.pages) {
    for (const error of page.hostErrors) {
      byServerId.set(error.serverId, error);
    }
  }
  return [...byServerId.values()];
}

function getNextAgentHistoryPageParam(
  page: AgentHistoryBatchPage,
): AgentHistoryCursorByServerId | null {
  const cursorByServerId: AgentHistoryCursorByServerId = {};
  for (const [serverId, pageInfo] of Object.entries(page.pageInfoByServerId)) {
    if (pageInfo.hasMore && pageInfo.nextCursor) {
      cursorByServerId[serverId] = pageInfo.nextCursor;
    }
  }

  return Object.keys(cursorByServerId).length > 0 ? cursorByServerId : null;
}

type HostOutcome =
  | { status: "fulfilled"; host: AgentHistoryHost; page: AgentHistoryPage }
  | { status: "rejected"; host: AgentHistoryHost; error: unknown };

/**
 * Settles each Host on its own. Without `sourceTimeoutMs` it waits for every Host. With it, a
 * Host that has not answered by then is returned as late (once at least one Host answered) and
 * reported through `onLateResult` when it does, so one slow sandbox never holds the page.
 */
async function settleHosts(
  hosts: readonly AgentHistoryHost[],
  fetchHost: (host: AgentHistoryHost) => Promise<AgentHistoryPage>,
  sourceTimeoutMs: number | undefined,
  onLateResult: ((result: LateAgentHistoryResult) => void) | undefined,
): Promise<{ settled: HostOutcome[]; late: AgentHistoryHost[] }> {
  const outcomes = new Map<AgentHistoryHost, HostOutcome>();
  let returned = false;
  let notify: () => void = () => undefined;
  const settle = async (host: AgentHistoryHost): Promise<void> => {
    let outcome: HostOutcome;
    try {
      outcome = { status: "fulfilled", host, page: await fetchHost(host) };
    } catch (error) {
      outcome = { status: "rejected", host, error };
    }
    if (returned) {
      onLateResult?.(outcome.status === "fulfilled" ? outcome : { host, error: outcome.error });
      return;
    }
    outcomes.set(host, outcome);
    notify();
  };
  const all = Promise.all(hosts.map(settle));
  if (sourceTimeoutMs !== undefined) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      all,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, sourceTimeoutMs);
      }),
    ]);
    clearTimeout(timer);
    // Past the deadline, wait only until some Host has rows to show (or every Host settled).
    while (
      outcomes.size < hosts.length &&
      ![...outcomes.values()].some((outcome) => outcome.status === "fulfilled")
    )
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
  } else {
    await all;
  }
  returned = true;
  return {
    settled: hosts.flatMap((host) => outcomes.get(host) ?? []),
    late: hosts.filter((host) => !outcomes.has(host)),
  };
}

export async function fetchAgentHistoryBatch(input: {
  hosts: readonly AgentHistoryHost[];
  cursorByServerId: AgentHistoryCursorByServerId | null;
  search?: string;
  activityFilter?: FetchAgentHistoryOptions["activityFilter"];
  sourceTimeoutMs?: number;
  onLateResult?: (result: LateAgentHistoryResult) => void;
}): Promise<AgentHistoryBatchPage> {
  const cursorByServerId = input.cursorByServerId ?? {};
  const hasCursorFilter = Object.keys(cursorByServerId).length > 0;
  const hostsToFetch = hasCursorFilter
    ? input.hosts.filter((host) => Object.hasOwn(cursorByServerId, host.serverId))
    : input.hosts;

  const { settled, late } = await settleHosts(
    hostsToFetch,
    (host) =>
      fetchAgentHistoryPage({
        client: host.client,
        serverId: host.serverId,
        cursor: cursorByServerId[host.serverId] ?? null,
        ...(input.search ? { search: input.search } : {}),
        ...(input.activityFilter ? { activityFilter: input.activityFilter } : {}),
      }),
    input.sourceTimeoutMs,
    input.onLateResult,
  );
  const pages = settled.flatMap((result) => (result.status === "fulfilled" ? [result] : []));
  if (pages.length === 0 && late.length === 0) {
    throw new Error(AGENT_HISTORY_ALL_HOSTS_FAILED_MESSAGE);
  }
  // Name each Host that failed. Losing that name is what would let the list quietly
  // under-report.
  const hostErrors = settled.flatMap((result) =>
    result.status === "rejected"
      ? [{ serverId: result.host.serverId, serverName: result.host.serverLabel }]
      : [],
  );

  const agents = pages.flatMap(({ host, page }) =>
    page.agents.map((agent) => Object.assign({}, agent, { serverLabel: host.serverLabel })),
  );
  const pageInfoByServerId = Object.fromEntries(
    pages.map(({ host, page }) => [host.serverId, page.pageInfo]),
  );
  return {
    agents: sortByLatestActivity(agents),
    pageInfoByServerId,
    hostErrors,
    ...(late.length
      ? {
          lateHosts: late.map((host) => ({
            serverId: host.serverId,
            serverName: host.serverLabel,
          })),
        }
      : {}),
    ...(input.search
      ? { isSearchTruncated: pages.some(({ page }) => page.isSearchTruncated) }
      : {}),
  };
}

/**
 * Merges a late Host's answer into the page its fetch built. Rows already shown keep their
 * relative order; the late rows take their chronological places among them.
 */
export function mergeLateAgentHistory(
  data: InfiniteData<AgentHistoryBatchPage, AgentHistoryCursorByServerId | null> | undefined,
  fetchId: string,
  result: LateAgentHistoryResult,
): InfiniteData<AgentHistoryBatchPage, AgentHistoryCursorByServerId | null> | undefined {
  const index = data?.pages.findIndex((page) => page.fetchId === fetchId) ?? -1;
  if (!data || index < 0) return data;
  const page = data.pages[index]!;
  const serverId = result.host.serverId;
  const lateHosts = (page.lateHosts ?? []).filter((host) => host.serverId !== serverId);
  let next: AgentHistoryBatchPage;
  if ("error" in result) {
    next = {
      ...page,
      lateHosts,
      hostErrors: [...page.hostErrors, { serverId, serverName: result.host.serverLabel }],
    };
  } else {
    const fresh = result.page.agents.map((agent) =>
      Object.assign({}, agent, { serverLabel: result.host.serverLabel }),
    );
    next = {
      ...page,
      lateHosts,
      // Rows retained from this Host's earlier pages give way to its fresh answer.
      agents: sortByLatestActivity([
        ...page.agents.filter((agent) => agent.serverId !== serverId),
        ...fresh,
      ]),
      pageInfoByServerId: { ...page.pageInfoByServerId, [serverId]: result.page.pageInfo },
      ...(page.isSearchTruncated !== undefined
        ? { isSearchTruncated: page.isSearchTruncated || result.page.isSearchTruncated }
        : {}),
    };
  }
  const pages = [...data.pages];
  pages[index] = next;
  return { ...data, pages };
}

export function useAgentHistory(options: {
  serverId?: string | null;
  enabled?: boolean;
  search?: string;
  activityFilter?: FetchAgentHistoryOptions["activityFilter"];
}): AgentHistoryResult {
  const { t } = useTranslation();
  const daemons = useHosts();
  const runtime = getHostRuntimeStore();
  const queryClient = useQueryClient();
  const serverId = useMemo(() => {
    const value = options.serverId;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }, [options.serverId]);
  const enabled = options.enabled ?? true;
  // A host the user asked about splits two ways: one this fetch can reach, and
  // one whose sessions will be missing from the answer. Both come out of here,
  // because dropping the unreachable ones silently is what lets the list — and
  // worse, "No sessions match" — overstate what was actually searched.
  const candidateServerIds = useMemo(
    () => (serverId ? [serverId] : daemons.map((daemon) => daemon.serverId)),
    [daemons, serverId],
  );
  // Read the statuses as values: a version counter read only for reactivity is dropped by the
  // React Compiler, which left a Host that came online after a cold start "unreachable" forever.
  const connectionStatuses = useHostRuntimeConnectionStatuses(candidateServerIds);
  const { targetHosts, unreachableHosts } = useMemo(() => {
    const serverLabelById = new Map(daemons.map((daemon) => [daemon.serverId, daemon.label]));
    const hosts: AgentHistoryHost[] = [];
    const unreachable: AgentHistoryHostError[] = [];

    for (const targetServerId of candidateServerIds) {
      const client = runtime.getClient(targetServerId);
      const serverName = serverLabelById.get(targetServerId) ?? targetServerId;
      if (!client || connectionStatuses.get(targetServerId) !== "online") {
        unreachable.push({ serverId: targetServerId, serverName });
        continue;
      }
      hosts.push({ serverId: targetServerId, serverLabel: serverName, client });
    }

    return { targetHosts: hosts, unreachableHosts: unreachable };
  }, [daemons, runtime, connectionStatuses, candidateServerIds]);
  // One gate, checked before the field is offered: a fleet where any host
  // predates search has no search, rather than a list that silently omits that
  // host's sessions.
  const isSearchSupported = useSessionStore(
    useCallback(
      (state) =>
        candidateServerIds.length > 0 &&
        candidateServerIds.every(
          (id) => state.sessions[id]?.serverInfo?.features?.agentHistorySearch === true,
        ),
      [candidateServerIds],
    ),
  );
  const search = useMemo(() => {
    const trimmed = options.search?.trim() ?? "";
    return isSearchSupported ? trimmed : "";
  }, [isSearchSupported, options.search]);
  const queryKey = useMemo(
    () => [
      ...(serverId ? agentHistoryQueryKey(serverId) : allAgentHistoryQueryKey(candidateServerIds)),
      search,
      options.activityFilter,
    ],
    [search, serverId, candidateServerIds, options.activityFilter],
  );
  const serverLabelById = useMemo(
    () => new Map(daemons.map((daemon) => [daemon.serverId, daemon.label])),
    [daemons],
  );

  const historyQuery = useInfiniteQuery<
    AgentHistoryBatchPage,
    Error,
    { pages: AgentHistoryBatchPage[] },
    readonly unknown[],
    AgentHistoryCursorByServerId | null
  >({
    queryKey,
    enabled: Boolean(enabled && targetHosts.length > 0),
    staleTime: 30_000,
    initialPageParam: null,
    getNextPageParam: getNextAgentHistoryPageParam,
    queryFn: async ({ pageParam }) => {
      if (targetHosts.length === 0) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const fetchId = createHistoryFetchId();
      const page = await fetchAgentHistoryBatch({
        hosts: targetHosts,
        cursorByServerId: pageParam,
        ...(search ? { search } : {}),
        ...(options.activityFilter ? { activityFilter: options.activityFilter } : {}),
        sourceTimeoutMs: AGENT_HISTORY_SOURCE_TIMEOUT_MS,
        onLateResult: (result) =>
          queryClient.setQueryData<
            InfiniteData<AgentHistoryBatchPage, AgentHistoryCursorByServerId | null>
          >(queryKey, (data) => mergeLateAgentHistory(data, fetchId, result)),
      });
      const registered = new Set(runtime.getHosts().map((host) => host.serverId));
      const retained = retainUnavailableHostHistory({
        page,
        cursorByServerId: pageParam,
        accepted: queryClient.getQueryData(queryKey),
        unavailableHostIds: new Set(
          [...unreachableHosts, ...page.hostErrors, ...(page.lateHosts ?? [])]
            .map((host) => host.serverId)
            .filter((id) => registered.has(id)),
        ),
      });
      return { ...retained, fetchId };
    },
  });
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetching,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = historyQuery;

  const refreshAll = useCallback(async () => {
    if (!enabled) return;
    // A manual retry must also attempt unavailable Hosts, rather than silently return
    // when none is online. Their shared connection owner publishes progress/failure.
    await Promise.allSettled([
      ...unreachableHosts.map((host) => runtime.restartHostConnection(host.serverId)),
      ...(targetHosts.length > 0 ? [refetch()] : []),
    ]);
  }, [enabled, refetch, targetHosts.length, unreachableHosts, runtime]);

  const loadMore = useCallback(() => {
    if (!enabled || targetHosts.length === 0 || !hasNextPage || isFetchingNextPage) {
      return;
    }
    void fetchNextPage();
  }, [enabled, fetchNextPage, hasNextPage, isFetchingNextPage, targetHosts.length]);

  const agents = useMemo(() => {
    const pages = data?.pages ?? [];
    // Retained failed pages can overlap a newly paginated page. Prefer the fresh first
    // occurrence, and never project a Host that the registry has actually removed.
    const historyAgents = new Map<string, AggregatedAgent>();
    for (const page of pages)
      for (const agent of page.agents) {
        const key = `${agent.serverId}:${agent.id}`;
        if (serverLabelById.has(agent.serverId) && !historyAgents.has(key))
          historyAgents.set(key, agent);
      }
    const labelledAgents = [...historyAgents.values()].map((agent) =>
      Object.assign({}, agent, {
        serverLabel: serverLabelById.get(agent.serverId) ?? agent.serverLabel,
      }),
    );
    return sortByLatestActivity(labelledAgents);
  }, [data?.pages, serverLabelById]);
  const isInitialLoad = isLoading && agents.length === 0;
  const isRevalidating = isFetching && !isFetchingNextPage && agents.length > 0;
  const isSearchTruncated = Boolean(search && data?.pages.some((page) => page.isSearchTruncated));
  const lateHosts = useMemo(() => {
    const byServerId = new Map<string, AgentHistoryHostError>();
    for (const page of data?.pages ?? [])
      for (const host of page.lateHosts ?? []) byServerId.set(host.serverId, host);
    return [...byServerId.values()];
  }, [data?.pages]);
  const hostErrors = useMemo(
    () =>
      collectAgentHistoryHostErrors({
        pages: data?.pages ?? [],
        unreachableHosts: [
          ...unreachableHosts,
          ...(isError
            ? targetHosts.map((host) => ({
                serverId: host.serverId,
                serverName: host.serverLabel,
              }))
            : []),
        ],
      }),
    [data?.pages, unreachableHosts, isError, targetHosts],
  );

  return {
    agents,
    isLoading,
    isInitialLoad,
    isRevalidating,
    isError,
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    isSearchSupported,
    isSearchTruncated,
    hostErrors,
    lateHosts,
    refreshAll,
    loadMore,
  };
}

let historyFetchSequence = 0;
function createHistoryFetchId(): string {
  historyFetchSequence += 1;
  return `history-${historyFetchSequence}`;
}
