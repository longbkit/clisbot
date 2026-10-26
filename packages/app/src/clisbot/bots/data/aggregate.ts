import type { AggregateLoadState } from "@/schedules/aggregated-schedules";
import { toErrorMessage } from "@/utils/error-messages";
import type { BotsClient, BotsHostInput, BotsRuntime, BotsRuntimeSnapshot } from "./client";

export type { AggregateLoadState } from "@/schedules/aggregated-schedules";

/** A record tagged with the host it came from, so one flat list renders host labels per row. */
export type HostTagged<T> = T & { serverId: string; serverName: string };

export interface HostError {
  serverId: string;
  serverName: string;
  message: string;
}

export type FetchAggregatedState<T> =
  | { status: "connecting" }
  | {
      status: "loaded";
      data: HostTagged<T>[];
      hostErrors: HostError[];
      acceptedServerIds: string[];
    };

export interface FetchAggregatedInput<T> {
  hosts: readonly BotsHostInput[];
  runtime: BotsRuntime;
  /** Reads one host's rows; a thrown error or a wire `error` counts against that host only. */
  load: (client: BotsClient) => Promise<{ rows: T[]; error?: string }>;
  allHostsFailedMessage: string;
}

function isConnectionSettling(snapshot: BotsRuntimeSnapshot | null | undefined): boolean {
  if (!snapshot) return true;
  return snapshot.connectionStatus === "connecting" || snapshot.connectionStatus === "idle";
}

function onlineClient(input: FetchAggregatedInput<unknown>, serverId: string): BotsClient | null {
  const snapshot = input.runtime.getSnapshot(serverId);
  if (snapshot?.connectionStatus !== "online") return null;
  return input.runtime.getClient(serverId);
}

/**
 * The schedules aggregate (`schedules/aggregated-schedules.ts`) generalised over the row
 * reader, so bots and chats share one connecting/loaded/host-error policy: offline hosts are
 * skipped, a failing host is a banner, and only every host failing throws.
 */
export async function fetchAggregated<T>(
  input: FetchAggregatedInput<T>,
): Promise<FetchAggregatedState<T>> {
  const hasSettlingHost = input.hosts.some((host) =>
    isConnectionSettling(input.runtime.getSnapshot(host.serverId)),
  );
  const askable = input.hosts.filter((host) => onlineClient(input, host.serverId) !== null);
  if (askable.length === 0 && hasSettlingHost) return { status: "connecting" };

  const data: HostTagged<T>[] = [];
  const hostErrors: HostError[] = [];
  const accepted = new Set<string>();
  await Promise.all(
    askable.map(async (host) => {
      const client = onlineClient(input, host.serverId);
      if (!client) return;
      try {
        const payload = await input.load(client);
        if (payload.error) throw new Error(payload.error);
        accepted.add(host.serverId);
        for (const row of payload.rows) {
          data.push({ ...row, serverId: host.serverId, serverName: host.serverName });
        }
      } catch (error) {
        hostErrors.push({ ...host, message: toErrorMessage(error) });
      }
    }),
  );

  if (askable.length > 0 && data.length === 0 && hostErrors.length === askable.length) {
    throw new Error(input.allHostsFailedMessage);
  }
  if (data.length === 0 && hasSettlingHost) return { status: "connecting" };
  return {
    status: "loaded",
    data,
    hostErrors,
    acceptedServerIds: input.hosts
      .filter((host) => accepted.has(host.serverId))
      .map((host) => host.serverId),
  };
}

export function toAggregateLoadState<T>(
  state: FetchAggregatedState<T> | undefined,
): AggregateLoadState<HostTagged<T>> {
  if (state?.status === "connecting") return { status: "connecting" };
  if (state?.status === "loaded") return { status: "loaded", data: state.data };
  return { status: "loading" };
}

/** Each Host's rows from its last answer, kept while that Host reconnects or fails. */
export type HeldHostRows<T> = ReadonlyMap<string, HostTagged<T>[]>;

/**
 * A list that has rows never drops back to loading for a background refresh, a reconnect or one
 * Host failing: a Host that answered replaces its rows, every other Host still listed keeps the
 * rows of its last answer. A Host that leaves the list takes its rows with it.
 */
export function holdAggregateRows<T>(
  held: HeldHostRows<T>,
  state: FetchAggregatedState<T> | undefined,
  serverIds: readonly string[],
): { held: HeldHostRows<T>; state: FetchAggregatedState<T> | undefined } {
  const answered = new Set(state?.status === "loaded" ? state.acceptedServerIds : []);
  const fresh = state?.status === "loaded" ? state.data : [];
  const next = new Map<string, HostTagged<T>[]>();
  const kept: HostTagged<T>[] = [];
  for (const serverId of serverIds) {
    if (answered.has(serverId)) {
      next.set(
        serverId,
        fresh.filter((row) => row.serverId === serverId),
      );
      continue;
    }
    const rows = held.get(serverId);
    if (!rows) continue;
    next.set(serverId, rows);
    kept.push(...rows);
  }
  if (state?.status === "loaded") {
    return { held: next, state: kept.length ? { ...state, data: [...fresh, ...kept] } : state };
  }
  if (next.size === 0) return { held: next, state };
  return {
    held: next,
    state: { status: "loaded", data: kept, hostErrors: [], acceptedServerIds: [] },
  };
}
