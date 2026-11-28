import { useDirectoryHealth, type DirectoryHealth } from "./use-directory-health";
import { useMemo, useCallback } from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "@/stores/session-store";
import type { AgentDirectoryEntry } from "@/types/agent-directory";
import type { Agent } from "@/stores/session-store";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { sharedAggregatedAgentProjector } from "./aggregated-agent-projector";
import { nativePerformanceTrace } from "@/performance/native-trace";
import { useAllDirectoryDemand } from "./use-directory-demand";

export interface AggregatedAgent extends AgentDirectoryEntry {
  serverId: string;
  serverLabel: string;
}

export interface AggregatedAgentsResult {
  agents: AggregatedAgent[];
  isLoading: boolean;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  refreshAll: () => void;
  directoryHealth: DirectoryHealth;
}

const NO_AGENT_MAPS: Record<string, Map<string, Agent> | undefined> = Object.freeze({});

export function useAggregatedAgents(options?: {
  includeArchived?: boolean;
  demand?: boolean;
  /**
   * COMPAT(clisbot-passive-directory): read the agents other surfaces already loaded without
   * holding directory demand (Home's inbox, Navigation V2 lists). Defaults to `demand`, so a
   * closed surface (upstream: the command center) stays off the agent maps.
   */
  observe?: boolean;
}): AggregatedAgentsResult {
  const daemons = useHosts();
  const runtime = getHostRuntimeStore();
  const includeArchived = options?.includeArchived ?? false;
  const demand = options?.demand ?? true;
  const observe = options?.observe ?? demand;
  const serverIds = useMemo(() => daemons.map((daemon) => daemon.serverId), [daemons]);
  useAllDirectoryDemand({ serverIds, enabled: demand });
  const directoryHealth = useDirectoryHealth();
  const isLoading = directoryHealth.status === "loading" || directoryHealth.status === "refreshing";

  // The caller has said it does not read the directory, so stay off the agent maps entirely:
  // every map change otherwise re-renders this hook and rebuilds the whole list for a surface
  // that is not on screen (the command center while it is closed).
  const sessionAgents = useSessionStore(
    useShallow((state) => {
      if (!observe) {
        return NO_AGENT_MAPS;
      }
      const result: Record<string, Map<string, Agent> | undefined> = {};
      for (const [serverId, session] of Object.entries(state.sessions)) {
        result[serverId] = session.agents;
      }
      return result;
    }),
  );

  const refreshAll = useCallback(() => {
    if (!demand) return;
    for (const serverId of serverIds) void runtime.refreshDirectories(serverId);
  }, [demand, runtime, serverIds]);

  const projectAgents = sharedAggregatedAgentProjector(includeArchived);
  const result = useMemo(() => {
    const tracing = nativePerformanceTrace.isEnabled();
    if (tracing) nativePerformanceTrace.beginSection("clisbot.agents.derive");
    const agents = projectAgents({ sessionAgents, hosts: daemons, includeArchived });
    if (tracing) nativePerformanceTrace.endSection();
    return { agents };
  }, [daemons, includeArchived, projectAgents, sessionAgents]);

  return {
    ...result,
    directoryHealth,
    isLoading,
    isInitialLoad: directoryHealth.status === "loading" && result.agents.length === 0,
    isRevalidating:
      directoryHealth.status === "refreshing" || (isLoading && result.agents.length > 0),
    refreshAll,
  };
}
