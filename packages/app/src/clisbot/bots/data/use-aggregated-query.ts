import { botsSessionScope } from "./session-scope";
import { useMemo, useState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import {
  fetchAggregated,
  holdAggregateRows,
  toAggregateLoadState,
  type FetchAggregatedState,
  type HeldHostRows,
  type AggregateLoadState,
  type FetchAggregatedInput,
  type HostError,
  type HostTagged,
} from "./aggregate";
import type { BotsHostInput, BotsRuntime } from "./client";

const LIST_STALE_TIME_MS = 5_000;
const EMPTY_SERVER_IDS: readonly string[] = [];

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
  /** Hosts whose RPC succeeded in this query/admission, including authoritative empty lists. */
  acceptedServerIds: readonly string[];
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
    // Query data never carries across a new transport admission: `acceptedServerIds` proves this
    // admission. The rows a reader already sees are held for display by `useHeldRows` below.
    dataShape: "value",
    staleTimeMs: LIST_STALE_TIME_MS,
    enabled: input.enabled ?? true,
  });
  const data = useHeldRows(query.data, serverIds);
  // Callers memoize on it: a fresh object per render re-ran the Work model's placement build.
  const loadState = useMemo(() => toAggregateLoadState(data), [data]);
  return {
    loadState,
    hostErrors: data?.status === "loaded" ? data.hostErrors : [],
    acceptedServerIds:
      data?.status === "loaded" ? (data.acceptedServerIds ?? EMPTY_SERVER_IDS) : EMPTY_SERVER_IDS,
    isError: query.isError,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
    isRefetching: query.isRefetching,
  };
}

interface Held<T> {
  source: FetchAggregatedState<T> | undefined;
  /** The Host ids by value: callers may pass a new array with the same Hosts on every render. */
  serverKey: string;
  rows: HeldHostRows<T>;
  shown: FetchAggregatedState<T> | undefined;
}

/**
 * The query's answer with each Host's last rows held across a new key: a reconnect changes the
 * key (admission and connection status are part of it), and the list must not blank meanwhile.
 */
function useHeldRows<T>(
  source: FetchAggregatedState<T> | undefined,
  serverIds: readonly string[],
): FetchAggregatedState<T> | undefined {
  const serverKey = serverIds.join("\n");
  const [held, setHeld] = useState<Held<T>>(() => ({
    source,
    serverKey,
    ...hold(new Map(), source, serverIds),
  }));
  if (held.source === source && held.serverKey === serverKey) return held.shown;
  const next = { source, serverKey, ...hold(held.rows, source, serverIds) };
  setHeld(next);
  return next.shown;
}

function hold<T>(
  rows: HeldHostRows<T>,
  source: FetchAggregatedState<T> | undefined,
  serverIds: readonly string[],
) {
  const result = holdAggregateRows(rows, source, serverIds);
  return { rows: result.held, shown: result.state };
}
