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
  | { status: "loaded"; data: HostTagged<T>[]; hostErrors: HostError[] };

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
  await Promise.all(
    askable.map(async (host) => {
      const client = onlineClient(input, host.serverId);
      if (!client) return;
      try {
        const payload = await input.load(client);
        if (payload.error) throw new Error(payload.error);
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
  return { status: "loaded", data, hostErrors };
}

export function toAggregateLoadState<T>(
  state: FetchAggregatedState<T> | undefined,
): AggregateLoadState<HostTagged<T>> {
  if (state?.status === "connecting") return { status: "connecting" };
  if (state?.status === "loaded") return { status: "loaded", data: state.data };
  return { status: "loading" };
}
