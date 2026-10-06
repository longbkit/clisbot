import { useMemo } from "react";
import { useBotsFeatureHosts } from "@/clisbot/bots/feature";
import { botsRuntime } from "@/clisbot/bots/data/runtime";
import { useBotsQuery } from "@/clisbot/bots/data/use-bots";
import { routeBotOptions, type RouteBotDaemon, type RouteBotOption } from "../channel-route-bot";

/** What "Start or continue a Bot" can pick: Bots on the Hosts this Hub has enrolled. */
export interface RouteBotOptions {
  options: RouteBotOption[];
  loading: boolean;
}

/** The Bots of every Host that reports the `bots` feature, for the Hub's Hosts only. */
export function useRouteBotOptions(daemons: readonly RouteBotDaemon[]): RouteBotOptions {
  const featureHosts = useBotsFeatureHosts();
  const hosts = useMemo(
    () => featureHosts.map((host) => ({ serverId: host.serverId, serverName: host.label })),
    [featureHosts],
  );
  const bots = useBotsQuery({ hosts, runtime: botsRuntime });
  const { loadState } = bots;
  return useMemo(
    () => ({
      options: loadState.status === "loaded" ? routeBotOptions(loadState.data, daemons) : [],
      loading: hosts.length > 0 && loadState.status !== "loaded",
    }),
    [daemons, hosts.length, loadState],
  );
}
