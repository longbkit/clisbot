import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  getHostRuntimeStore,
  useHosts,
  type HostRuntimeConnectionStatus,
  type HostRuntimeAgentDirectoryStatus,
} from "@/runtime/host-runtime";

export type DirectoryHealth = { hasAcceptedResult: boolean } & (
  | { status: "loading" | "refreshing" | "ready"; message: null; serverId: null }
  | { status: "unavailable"; message: string; serverId: string; recovery: "retry" | "connection" }
);

/** Observe transport/directory readiness, never the runtime's unrelated notification version. */
export function useDirectoryHealth(
  serverIds?: readonly string[],
  kind: "agents" | "workspaces" = "agents",
): DirectoryHealth {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const selected = useMemo(
    () => (serverIds ? hosts.filter((host) => serverIds.includes(host.serverId)) : hosts),
    [hosts, serverIds],
  );
  const subscribe = useCallback((notify: () => void) => runtime.subscribeAll(notify), [runtime]);
  const read = useCallback(
    () =>
      JSON.stringify(
        selected.map((host) => {
          const snapshot = runtime.getSnapshot(host.serverId);
          return {
            serverId: host.serverId,
            label: host.label,
            connection: snapshot?.connectionStatus ?? "connecting",
            directory:
              (kind === "agents"
                ? snapshot?.agentDirectoryStatus
                : snapshot?.workspaceDirectoryStatus) ?? "idle",
            loaded:
              (kind === "agents"
                ? snapshot?.hasEverLoadedAgentDirectory
                : snapshot?.hasEverLoadedWorkspaceDirectory) ?? false,
            error:
              (kind === "agents"
                ? snapshot?.agentDirectoryError
                : snapshot?.workspaceDirectoryError) ??
              snapshot?.lastError ??
              null,
          };
        }),
      ),
    [runtime, selected, kind],
  );
  const snapshot = useSyncExternalStore(subscribe, read, read);
  return useMemo(() => projectHealth(JSON.parse(snapshot)), [snapshot]);
}

interface DirectoryHostHealth {
  serverId: string;
  label: string;
  connection: HostRuntimeConnectionStatus;
  directory: HostRuntimeAgentDirectoryStatus;
  loaded: boolean;
  error: string | null;
}

function projectHealth(hosts: DirectoryHostHealth[]): DirectoryHealth {
  const hasAcceptedResult = hosts.every((host) => host.loaded);
  const failed = hosts.find(
    (host) => host.error || host.connection === "offline" || host.connection === "error",
  );
  if (failed)
    return {
      hasAcceptedResult,
      status: "unavailable",
      serverId: failed.serverId,
      recovery: failed.connection === "online" ? "retry" : "connection",
      message: `${failed.label}: ${failed.error ?? "Disconnected. Reconnect to refresh conversations."}`,
    };
  const pending = hosts.filter(
    (host) =>
      host.directory === "initial_loading" ||
      host.directory === "revalidating" ||
      (host.directory === "idle" && ["idle", "connecting", "online"].includes(host.connection)) ||
      host.connection === "connecting",
  );
  if (pending.length)
    return {
      hasAcceptedResult,
      status: pending.some((host) => !host.loaded) ? "loading" : "refreshing",
      message: null,
      serverId: null,
    };
  return { hasAcceptedResult, status: "ready", message: null, serverId: null };
}
