import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

interface AgentDirectoryProgress {
  hasEverLoadedAgentDirectory: boolean;
}

const SEPARATOR = "\n";

/**
 * The Hosts whose agent directory has loaded at least once, as a string. Every runtime emit (a
 * status flip, a heartbeat) re-reads it, but an equal string re-renders nobody.
 */
export function agentDirectoryReadyKey(
  serverIds: readonly string[],
  snapshotOf: (serverId: string) => AgentDirectoryProgress | null,
): string {
  return serverIds
    .filter((serverId) => snapshotOf(serverId)?.hasEverLoadedAgentDirectory === true)
    .join(SEPARATOR);
}

export function parseAgentDirectoryReadyKey(key: string): ReadonlySet<string> {
  return new Set(key === "" ? [] : key.split(SEPARATOR));
}

/**
 * Per-Host agent-directory readiness, not the aggregate flag: the aggregate `isInitialLoad` flips
 * false as soon as any Host has agents, so a Host still loading would read as "gone".
 */
export function useAgentDirectoryReadyHosts(serverIds: readonly string[]): ReadonlySet<string> {
  const runtime = getHostRuntimeStore();
  const readKey = useCallback(
    () => agentDirectoryReadyKey(serverIds, (serverId) => runtime.getSnapshot(serverId)),
    [runtime, serverIds],
  );
  const subscribe = useCallback(
    (onStoreChange: () => void) => runtime.subscribeAll(onStoreChange),
    [runtime],
  );
  const key = useSyncExternalStore(subscribe, readKey, readKey);
  return useMemo(() => parseAgentDirectoryReadyKey(key), [key]);
}
