import { useMemo } from "react";
import { useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import { useHubAccount } from "../account-provider";
import { useHostInventory } from "../host-inventory";
import { projectHubHostOnboarding } from "../host-onboarding";

/** One projection for the Hosts page and its live navigation count. */
export function useHostsSettingsInventory() {
  const hub = useHubAccount();
  const inventory = useHostInventory();
  const { hosts, daemons } = inventory;
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const items = useMemo(
    () =>
      projectHubHostOnboarding({
        daemons:
          hub.enabled && hub.signedIn && !daemons.isPlaceholderData
            ? (daemons.data?.daemons ?? [])
            : [],
        hosts,
        connectionStatuses,
      }),
    [hub.enabled, hub.signedIn, daemons.isPlaceholderData, daemons.data, hosts, connectionStatuses],
  );
  const savedHosts = hosts.filter((host) => !items.some((item) => item.serverId === host.serverId));
  const onlineCount =
    items.filter((item) => item.status === "online").length +
    savedHosts.filter((host) => connectionStatuses.get(host.serverId) === "online").length;
  return {
    ...inventory,
    items,
    savedHosts,
    connectionStatuses,
    onlineCount,
    totalCount: items.length + savedHosts.length,
  };
}
