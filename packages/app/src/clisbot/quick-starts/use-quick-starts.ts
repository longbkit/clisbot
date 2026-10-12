import { useFetchQuery } from "@/data/query";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { botsSessionScope } from "@/clisbot/bots/data/session-scope";
import { useResourcePrincipalScope } from "@/clisbot/bots/data/resource-principal-scope";

export function useQuickStarts(serverId: string) {
  const client = useHostRuntimeClient(serverId);
  const connection = useHostRuntimeConnectionStatus(serverId);
  const supported = useHostFeature(serverId, "quickStarts");
  const principal = useResourcePrincipalScope();
  const admission = botsSessionScope(getHostRuntimeStore().getSnapshot(serverId));
  const cache = useQueryClient();
  const key = ["quick-starts", serverId, principal, admission];
  const query = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 15_000,
    queryKey: key,
    enabled: supported && connection === "online" && !!client,
    queryFn: async () => {
      if (!client) throw new Error("Host is offline");
      const response = await client.listQuickStarts();
      if (response.error) throw new Error(response.error);
      return response;
    },
  });
  useEffect(() => {
    if (!supported || connection !== "online" || !client) return;
    const feed = client.observeEvents(["quick_start.changed"]);
    const invalidate = () => {
      void cache.invalidateQueries({ queryKey: ["quick-starts", serverId] });
    };
    feed.subscribe({ snapshot: invalidate, update: invalidate });
    return () => {
      void feed.release().catch(() => undefined);
    };
  }, [client, supported, connection, serverId, cache, admission]);
  return {
    ...query,
    client,
    supported,
    online: connection === "online",
    refresh: () => query.refetch(),
  };
}
