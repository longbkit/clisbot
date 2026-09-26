import type { BotsClient, BotsHostInput, BotsRuntime } from "./client";
import type { BotPayload } from "./contracts";
import { botsQueryKey } from "./query-keys";
import { useAggregatedQuery, type AggregatedQueryResult } from "./use-aggregated-query";

export const ALL_BOT_HOSTS_FAILED_MESSAGE = "No connected hosts could load bots";

export type AggregatedBot = BotPayload & { serverId: string; serverName: string };

async function loadBots(client: BotsClient) {
  const payload = await client.botList();
  return { rows: payload.bots, error: payload.error };
}

/** Bots across the feature hosts; the caller passes only hosts that report the `bots` feature. */
export function useBotsQuery(input: {
  hosts: readonly BotsHostInput[];
  runtime: BotsRuntime;
}): AggregatedQueryResult<BotPayload> {
  return useAggregatedQuery({
    hosts: input.hosts,
    runtime: input.runtime,
    queryKey: botsQueryKey(input.hosts.map((host) => host.serverId)),
    load: loadBots,
    allHostsFailedMessage: ALL_BOT_HOSTS_FAILED_MESSAGE,
    enabled: input.hosts.length > 0,
  });
}
