import { useMemo } from "react";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import { useHostFeature, useHostFeatureMap } from "@/runtime/host-features";

// COMPAT(connectors): added in v0.10.2-fusion; remove the gate after 2027-06-30.
const CONNECTORS_FEATURE = "connectors";

/** The gate every Connectors component starts with (docs/features/connectors/README.md). */
export function useHostConnectorsFeature(serverId: string | null | undefined): boolean {
  return useHostFeature(serverId, CONNECTORS_FEATURE);
}

/** Hosts whose daemon reports `connectors`; empty means the app shows no Connectors at all. */
export function useConnectorsFeatureHosts(): { serverId: string; label: string }[] {
  const hosts = useAvailableHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const flags = useHostFeatureMap(serverIds, CONNECTORS_FEATURE);
  return useMemo(
    () =>
      hosts
        .filter((host) => flags.get(host.serverId) === true)
        .map((host) => ({ serverId: host.serverId, label: host.label })),
    [flags, hosts],
  );
}
