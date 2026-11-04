import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { useToast } from "@/contexts/toast-context";
import type { WorkspaceTabFollow } from "@/screens/workspace/workspace-tab-menu";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

/** Keeps the Host's follows for this device's reader in the store, on every connect. */
export function useSyncFollows(client: DaemonClient, serverId: string): void {
  useEffect(() => {
    const sync = () => {
      void client
        .listNotificationFollows()
        .then((agentIds) => useSessionStore.getState().setFollowedAgents(serverId, agentIds))
        .catch(() => undefined);
    };
    if (client.isConnected) sync();
    return client.subscribeConnectionStatus((state) => {
      if (state.status === "connected") sync();
    });
  }, [client, serverId]);
}

/** The workspace tab menu's Follow item for a Host, or undefined when it cannot follow. */
export function useTabFollow(serverId: string): WorkspaceTabFollow | undefined {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const followedAgentIds = useSessionStore((state) => state.sessions[serverId]?.followedAgentIds);
  const supported = client?.supportsNotificationFollows() === true;
  return useMemo(() => {
    if (!client || !supported) return undefined;
    const isFollowed = (agentId: string) => followedAgentIds?.has(agentId) === true;
    return {
      isFollowed,
      followLabel: t("notificationScope.follow"),
      unfollowLabel: t("notificationScope.unfollow"),
      onToggle: (agentId) => {
        const followed = !isFollowed(agentId);
        void client
          .setNotificationFollow(agentId, followed)
          .then(() => {
            const next = new Set(followedAgentIds ?? []);
            if (followed) next.add(agentId);
            else next.delete(agentId);
            useSessionStore.getState().setFollowedAgents(serverId, next);
            return undefined;
          })
          .catch(() => toast.error(t("notificationScope.followFailed")));
      },
    };
  }, [client, followedAgentIds, serverId, supported, t, toast]);
}
