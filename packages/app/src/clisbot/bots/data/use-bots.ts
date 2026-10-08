import type { BotsClient, BotsHostInput, BotsRuntime } from "./client";
import type { BotPayload } from "./contracts";
import { botsQueryKey } from "./query-keys";
import { useTranslation } from "react-i18next";
import { useAggregatedQuery, type AggregatedQueryResult } from "./use-aggregated-query";

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
  const { t } = useTranslation();
  return useAggregatedQuery({
    hosts: input.hosts,
    runtime: input.runtime,
    queryKey: botsQueryKey(input.hosts.map((host) => host.serverId)),
    load: loadBots,
    allHostsFailedMessage: t("bots.workspace.errors.noHostLoadedBots"),
    enabled: input.hosts.length > 0,
  });
}
