import { useCallback, useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { buildConnectBotToChannelRoute, CONNECT_BOT_PARAMS } from "../navigation";
import { useHubAccount } from "../account-provider";
import { HubConnectionSettings } from "@/device-access/hub-settings";
import { ChannelSettings } from "./channel-settings";

/** Channels, opened on Add Route for a Bot when "Connect to a channel…" sent the user here. */
export function ChannelsSettingsRoute() {
  const router = useRouter();
  const hub = useHubAccount();
  const params = useLocalSearchParams<{
    [CONNECT_BOT_PARAMS.bot]?: string;
    [CONNECT_BOT_PARAMS.host]?: string;
  }>();
  const botId = params[CONNECT_BOT_PARAMS.bot];
  const serverId = params[CONNECT_BOT_PARAMS.host];
  const connectBot = useMemo(
    () =>
      typeof botId === "string" && botId && typeof serverId === "string" && serverId
        ? { serverId, botId }
        : null,
    [botId, serverId],
  );
  // The request is spent once the form opened, so a reload or Back does not reopen it.
  const clearConnectBot = useCallback(
    () =>
      router.setParams({
        [CONNECT_BOT_PARAMS.bot]: undefined,
        [CONNECT_BOT_PARAMS.host]: undefined,
      }),
    [router],
  );
  const returnToBot = useCallback(() => {
    if (connectBot)
      router.replace(buildConnectBotToChannelRoute(connectBot.serverId, connectBot.botId));
  }, [connectBot, router]);
  if (connectBot && !hub.enabled)
    return <HubConnectionSettings startOnHost={connectBot.serverId} onConnected={returnToBot} />;
  return <ChannelSettings connectBot={connectBot} onConnectBotOpened={clearConnectBot} />;
}
