import type { HubLocalStartStatus } from "@clisbot/protocol/hub-local";
import { getDesktopHost } from "@/desktop/host";
import { useSessionStore, type DaemonServerInfo } from "@/stores/session-store";

export type HubStartStatus = HubLocalStartStatus | { status: "unknown" };

/** Subscribe to server_info itself: runtime connection snapshots do not change for authority updates. */
export function useHubStartStatus(serverId: string, localServerId: string | null): HubStartStatus {
  const info = useSessionStore((state) => state.sessions[serverId]?.serverInfo);
  // Desktop uses its local operator CLI, independently of remote session authority.
  if (serverId === localServerId && getDesktopHost()?.invoke) return { status: "ready" };
  return resolveHubStartStatus(info);
}

function resolveHubStartStatus(
  info: Pick<DaemonServerInfo, "features" | "localHubStartStatus"> | null | undefined,
): HubStartStatus {
  if (info?.features?.localHubStartStatus === true)
    return info.localHubStartStatus ?? { status: "unknown" };
  // COMPAT(localHubStartStatus): v0.11.1; review 2027-04-10. Preserve previously advertised
  // startup, but never infer a denial reason from an older Host's omitted capability.
  if (info?.features?.localHubStart === true) return { status: "ready" };
  return { status: "unknown" };
}
