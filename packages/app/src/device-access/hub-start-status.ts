import { reconcileLegacyHubStartStatus } from "./hub-start-availability";
import { useFetchQuery } from "@/data/query";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { HubLocalStartStatus } from "@clisbot/protocol/hub-local";
import { getDesktopHost } from "@/desktop/host";
import { useSessionStore, type DaemonServerInfo } from "@/stores/session-store";

export type HubStartStatus =
  | HubLocalStartStatus
  | { status: "unknown" | "checking" | "check_failed" };

/** Subscribe to server_info itself: runtime connection snapshots do not change for authority updates. */
export function useHubStartStatus(
  serverId: string,
  localServerId: string | null,
  attempt = 0,
): HubStartStatus {
  const info = useSessionStore((state) => state.sessions[serverId]?.serverInfo);
  const recheckMembership =
    info?.localHubStartStatus?.status === "blocked" &&
    info.localHubStartStatus.reason === "managed_access" &&
    info.features?.hubRelationship === true;
  const membership = useFetchQuery({
    queryKey: ["hub-start-membership", serverId, attempt],
    queryFn: async () => {
      const client = getHostRuntimeStore().getSnapshot(serverId)?.client;
      if (!client) throw new Error("Host disconnected");
      return (await client.getHubStatus()).status;
    },
    dataShape: "value",
    enabled: recheckMembership,
    retry: 1,
    staleTimeMs: 5000,
  });
  // Desktop uses its local operator CLI, independently of remote session authority.
  if (serverId === localServerId && getDesktopHost()?.invoke) return { status: "ready" };
  // COMPAT(startupPolicyVsMembership): older startup diagnostics use raw external policy.
  // Added CTO-011; review after 2027-04-10. Membership proof explains refusal, never invents permission.
  if (recheckMembership && info?.localHubStartStatus)
    return reconcileLegacyHubStartStatus({
      reported: info.localHubStartStatus,
      devicePairing: info.features?.devicePairing === true,
      membership: membership.data,
      failed: !!membership.error,
    });
  return resolveHubStartStatus(info);
}

export function resolveHubStartStatus(
  info: Pick<DaemonServerInfo, "features" | "localHubStartStatus"> | null | undefined,
): HubStartStatus {
  if (!info) return { status: "checking" };
  if (info?.features?.localHubStartStatus === true)
    return info.localHubStartStatus ?? { status: "checking" };
  // COMPAT(localHubStartStatus): v0.11.1; review 2027-04-10. Preserve previously advertised
  // startup, but never infer a denial reason from an older Host's omitted capability.
  if (info?.features?.localHubStart === true) return { status: "ready" };
  return { status: "unknown" };
}
