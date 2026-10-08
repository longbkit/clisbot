import { useMemo, useSyncExternalStore } from "react";
import { getHostRuntimeStore } from "./host-runtime";

/** Hosts whose last connection attempt failed (`offline` or `error`). */
export function useHostRuntimeUnreachableServerIds(serverIds: readonly string[]): string[] {
  const store = getHostRuntimeStore();
  const read = () =>
    serverIds
      .filter((serverId) => {
        const status = store.getSnapshot(serverId)?.connectionStatus;
        return status === "offline" || status === "error";
      })
      .join("\u0000");
  const key = useSyncExternalStore(
    (onStoreChange) => {
      const unsubscribers = serverIds.map((serverId) => store.subscribe(serverId, onStoreChange));
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    },
    read,
    read,
  );
  return useMemo(() => (key ? key.split("\u0000") : []), [key]);
}
