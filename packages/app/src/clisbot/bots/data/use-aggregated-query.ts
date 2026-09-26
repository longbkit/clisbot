import { botsSessionScope } from "./session-scope";
import { useMemo } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import {
  fetchAggregated,
  toAggregateLoadState,
  type AggregateLoadState,
  type FetchAggregatedInput,
  type HostError,
  type HostTagged,
} from "./aggregate";
import type { BotsHostInput, BotsRuntime } from "./client";

const LIST_STALE_TIME_MS = 5_000;

export interface AggregatedQueryInput<T> {
  hosts: readonly BotsHostInput[];
  runtime: BotsRuntime;
  /** Base key; the hook appends the connection-status key so a dropped host changes the key. */
  queryKey: QueryKey;
  load: FetchAggregatedInput<T>["load"];
  allHostsFailedMessage: string;
  enabled?: boolean;
}

export interface AggregatedQueryResult<T> {
  loadState: AggregateLoadState<HostTagged<T>>;
  hostErrors: HostError[];
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  isRefetching: boolean;
}

/** The `useSchedules` shape (`hooks/use-schedules.ts`) with the row reader injected. */
export function useAggregatedQuery<T>(input: AggregatedQueryInput<T>): AggregatedQueryResult<T> {
  const serverIds = useMemo(() => input.hosts.map((host) => host.serverId), [input.hosts]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const connectionStatusKey = useMemo(
    () => serverIds.map((serverId) => connectionStatuses.get(serverId) ?? "connecting").join("|"),
    [connectionStatuses, serverIds],
  );
  const { hosts, runtime, load, allHostsFailedMessage } = input;
  const admissionKey = serverIds
    .map((id) => `${id}:${botsSessionScope(runtime.getSnapshot(id))}`)
    .join("|");
  const query = useFetchQuery({
    queryKey: [...input.queryKey, connectionStatusKey, admissionKey],
    queryFn: () => fetchAggregated({ hosts, runtime, load, allHostsFailedMessage }),
    // List placeholders must not carry data across a new transport admission.
    dataShape: "value",
    staleTimeMs: LIST_STALE_TIME_MS,
    enabled: input.enabled ?? true,
  });
  return {
    loadState: toAggregateLoadState(query.data),
    hostErrors: query.data?.status === "loaded" ? query.data.hostErrors : [],
    isError: query.isError,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
    isRefetching: query.isRefetching,
  };
}
