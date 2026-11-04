import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { useToast } from "@/contexts/toast-context";
import type { WorkspaceTabFollow } from "@/screens/workspace/workspace-tab-menu";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

/**
 * Keeps the Host's follows for this device's reader in the store: listed on every connect, then
 * live as any of the reader's devices follows or unfollows (`notifications.follows_changed`).
 */
export function useSyncFollows(client: DaemonClient, serverId: string): void {
  useEffect(() => {
    const apply = (agentIds: readonly string[]) =>
      useSessionStore.getState().setFollowedAgents(serverId, agentIds);
    let feed: ReturnType<DaemonClient["observeEvents"]> | null = null;
    let stopFeed: (() => void) | null = null;
    const sync = () => {
      void client
        .listNotificationFollows()
        .then(apply)
        .catch(() => undefined);
      // Only a Host that advertises follows knows this event; an older one rejects it.
      if (feed || !client.supportsNotificationFollows()) return;
      feed = client.observeEvents(["notifications.follows_changed"]);
      stopFeed = feed.subscribe({
        snapshot: () => {},
        update: (message) => {
          if (message.type === "notifications.follows_changed") apply(message.payload.agentIds);
        },
      });
    };
    if (client.isConnected) sync();
    const stopStatus = client.subscribeConnectionStatus((state) => {
      if (state.status === "connected") sync();
    });
    return () => {
      stopStatus();
      stopFeed?.();
      void feed?.release().catch(() => undefined);
    };
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
            // The store's set now, not the one this menu was built from: toggles can overlap.
            const current = useSessionStore.getState().sessions[serverId]?.followedAgentIds;
            const next = new Set(current ?? []);
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
