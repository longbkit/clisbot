import { useMemo } from "react";
import { useFetchQuery } from "@/data/query";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  canManageTerminalProfiles,
  launchableFromConfig,
  type LaunchableTerminalProfiles,
} from "./launchable";

/** The profiles and shell a launch menu offers in `cwd`'s Project on this Host. */
export function useLaunchableTerminalProfiles(
  serverId: string,
  cwd: string | null,
): LaunchableTerminalProfiles {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const serverInfo = useSessionStore((state) => state.sessions[serverId]?.serverInfo);
  const grantsAware = serverInfo?.features?.terminalProfileGrants === true;
  const { config } = useDaemonConfig(grantsAware ? null : serverId);
  const listed = useFetchQuery({
    queryKey: ["terminal-profiles", serverId, cwd],
    queryFn: async () => client!.listTerminalProfiles(cwd!),
    enabled: grantsAware && isConnected && client !== null && cwd !== null,
    dataShape: "value",
    staleTimeMs: 30_000,
  });
  const permissions = serverInfo?.permissions;
  return useMemo(() => {
    if (!grantsAware) return launchableFromConfig(config?.terminalProfiles, permissions);
    return {
      profiles: listed.data?.profiles ?? [],
      shell: listed.data?.shell ?? false,
      canManageProfiles: canManageTerminalProfiles(permissions),
    };
  }, [config?.terminalProfiles, grantsAware, listed.data, permissions]);
}
