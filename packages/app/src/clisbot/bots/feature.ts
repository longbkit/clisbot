import { useMemo } from "react";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import { useHostFeature, useHostFeatureMap, type HostFeatureName } from "@/runtime/host-features";

// TODO(bots-wire): drop this alias and the cast once `bots` is in the `server_info` features
// object (`packages/protocol/src/messages.ts`, README D10); `HostFeatureName` derives from it.
const BOTS_FEATURE = "bots" as HostFeatureName;

/** The one gate every fusion bots component starts with (docs/features/bots-and-chats/plans/app.md §3). */
export function useHostBotsFeature(serverId: string | null | undefined): boolean {
  return useHostFeature(serverId, BOTS_FEATURE);
}

/** Host ids from the inventory whose daemon reports the `bots` feature; empty means render nothing. */
export function useBotsFeatureHosts(): { serverId: string; label: string }[] {
  const hosts = useAvailableHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const flags = useHostFeatureMap(serverIds, BOTS_FEATURE);
  return useMemo(
    () =>
      hosts
        .filter((host) => flags.get(host.serverId) === true)
        .map((host) => ({ serverId: host.serverId, label: host.label })),
    [flags, hosts],
  );
}
