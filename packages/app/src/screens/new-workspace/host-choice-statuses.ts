import { useMemo, useSyncExternalStore } from "react";
import { getHostRuntimeStore, type HostRuntimeConnectionStatus } from "@/runtime/host-runtime";

type UnreachableStatus = Extract<HostRuntimeConnectionStatus, "offline" | "error">;

function isUnreachable(status: HostRuntimeConnectionStatus): status is UnreachableStatus {
  return status === "offline" || status === "error";
}

/**
 * A Host's status as the start screen's Host choice reads it. A Host that failed and is
 * retrying stays unreachable until it is online or fails differently: each retry turns it
 * `connecting` and back to `error`, and with a dozen unreachable Hosts those flips re-rendered
 * Home about twice a second, ~35 ms each on a Galaxy S23, which made Mode and model picks lag.
 */
export function projectHostChoiceStatus(
  status: HostRuntimeConnectionStatus,
  previous: HostRuntimeConnectionStatus | undefined,
): HostRuntimeConnectionStatus {
  if ((status === "connecting" || status === "idle") && previous && isUnreachable(previous)) {
    return previous;
  }
  return status;
}

// Per Host, not per screen: whether a Host is known unreachable does not depend on who asks.
const lastChoiceStatus = new Map<string, HostRuntimeConnectionStatus>();

function readHostChoiceStatuses(serverIds: readonly string[]): string {
  const store = getHostRuntimeStore();
  return serverIds
    .map((serverId) => {
      const status = store.getSnapshot(serverId)?.connectionStatus ?? "connecting";
      const projected = projectHostChoiceStatus(status, lastChoiceStatus.get(serverId));
      lastChoiceStatus.set(serverId, projected);
      return projected;
    })
    .join("\n");
}

/** `useHostRuntimeConnectionStatuses` through `projectHostChoiceStatus`. */
export function useHostChoiceStatuses(
  serverIds: readonly string[],
): ReadonlyMap<string, HostRuntimeConnectionStatus> {
  const store = getHostRuntimeStore();
  const read = () => readHostChoiceStatuses(serverIds);
  const statuses = useSyncExternalStore((onChange) => store.subscribeAll(onChange), read, read);
  return useMemo(() => {
    const values = statuses.split("\n") as HostRuntimeConnectionStatus[];
    return new Map(serverIds.map((serverId, index) => [serverId, values[index]!]));
  }, [serverIds, statuses]);
}
