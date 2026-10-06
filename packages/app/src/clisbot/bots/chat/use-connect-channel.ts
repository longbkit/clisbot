import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useHubAccount } from "@/clisbot/hub/account-provider";
import { useHubDaemonsQuery } from "@/clisbot/hub/host-inventory";
import { buildConnectBotToChannelRoute } from "@/clisbot/hub/navigation";

/**
 * Connect to a channel… adds a Route on the Hub that runs the Bot: the Route form picks its
 * target only for an Organization Admin (a Connection Admin keeps an existing one), and the Hub
 * can run a Bot only on a Host it has enrolled. Returns whether the Bot on `serverId` qualifies.
 */
export function useCanConnectBotToChannel(): (serverId: string) => boolean {
  const hub = useHubAccount();
  const daemons = useHubDaemonsQuery();
  const canManage = hub.enabled && hub.signedIn?.capabilities.manageResources === true;
  const enrolled = daemons.data?.daemons;
  return useCallback(
    (serverId: string) =>
      canManage &&
      enrolled?.some((daemon) => daemon.connectionOffer?.serverId === serverId) === true,
    [canManage, enrolled],
  );
}

/** Opens Channels' Add Route with "Start or continue a Bot" and this Bot picked. */
export function useOpenConnectBotToChannel(): (serverId: string, botId: string) => void {
  const router = useRouter();
  return useCallback(
    (serverId: string, botId: string) =>
      router.push(buildConnectBotToChannelRoute(serverId, botId)),
    [router],
  );
}
