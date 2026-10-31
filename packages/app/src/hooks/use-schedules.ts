import { useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
  type HostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import {
  fetchAggregatedSchedules,
  schedulesQueryBaseKey,
  type AggregateLoadState,
  type AggregatedSchedule,
  type ScheduleHostError,
  type ScheduleHostInput,
} from "@/schedules/aggregated-schedules";

export type {
  AggregateLoadState,
  AggregatedSchedule,
  ScheduleHostError,
} from "@/schedules/aggregated-schedules";

export function schedulesQueryKey(serverIds: readonly string[]) {
  return [...schedulesQueryBaseKey, [...serverIds].sort().join("|")] as const;
}

/**
 * What the aggregated fetch's answer depends on: the Hosts it asks (online) and whether any Host is
 * still settling. Keying on every status refetched all Hosts on each offline/error/connecting flip,
 * which a cold start with a fleet of Hub Hosts produces many times a minute.
 */
export function schedulesConnectionKey(
  serverIds: readonly string[],
  statuses: ReadonlyMap<string, HostRuntimeConnectionStatus>,
): string {
  const statusOf = (serverId: string) => statuses.get(serverId) ?? "connecting";
  const online = serverIds.filter((serverId) => statusOf(serverId) === "online");
  const settling = serverIds.some((serverId) => {
    const status = statusOf(serverId);
    return status === "connecting" || status === "idle";
  });
  return `${online.join("|")}#${settling ? "settling" : "settled"}`;
}

export interface UseSchedulesResult {
  loadState: AggregateLoadState<AggregatedSchedule>;
  hostErrors: ScheduleHostError[];
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  isRefetching: boolean;
}

export function useSchedules(): UseSchedulesResult {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const hostInputs = useMemo<ScheduleHostInput[]>(
    () => hosts.map((host) => ({ serverId: host.serverId, serverName: host.label })),
    [hosts],
  );
  const serverIds = useMemo(() => hostInputs.map((host) => host.serverId), [hostInputs]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const connectionStatusKey = useMemo(
    () => schedulesConnectionKey(serverIds, connectionStatuses),
    [connectionStatuses, serverIds],
  );

  const query = useFetchQuery({
    queryKey: [...schedulesQueryKey(serverIds), connectionStatusKey],
    queryFn: () => fetchAggregatedSchedules({ hosts: hostInputs, runtime }),
    dataShape: "list",
    staleTimeMs: 5_000,
  });

  let loadState: AggregateLoadState<AggregatedSchedule>;
  if (query.data?.status === "connecting") {
    loadState = { status: "connecting" };
  } else if (query.data?.status === "loaded") {
    loadState = { status: "loaded", data: query.data.data };
  } else {
    loadState = { status: "loading" };
  }

  return {
    loadState,
    hostErrors: query.data?.status === "loaded" ? query.data.hostErrors : [],
    isError: query.isError,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
    isRefetching: query.isRefetching,
  };
}
