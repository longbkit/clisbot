import { canOpenChannelSetup } from "./channel-setup-entry";
import { useCallback } from "react";
import { useRouter } from "expo-router";
import { buildConnectBotToChannelRoute } from "@/clisbot/hub/navigation";

/** The setup entry is available before Hub enrollment. Authority is checked by
 * the guided flow and the Host/Hub operations it invokes. */
export function useCanConnectBotToChannel(): (serverId: string) => boolean {
  return useCallback(canOpenChannelSetup, []);
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
