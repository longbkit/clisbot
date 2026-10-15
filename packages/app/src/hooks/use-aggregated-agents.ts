import { useMemo, useCallback, useEffect, useSyncExternalStore } from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "@/stores/session-store";
import type { AgentDirectoryEntry } from "@/types/agent-directory";
import type { Agent } from "@/stores/session-store";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { createAggregatedAgentProjector } from "./aggregated-agent-projector";
import { nativePerformanceTrace } from "@/performance/native-trace";

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
}

export function useAggregatedAgents(options?: {
  includeArchived?: boolean;
  demand?: boolean;
}): AggregatedAgentsResult {
  const daemons = useHosts();
  const runtime = getHostRuntimeStore();
  const includeArchived = options?.includeArchived ?? false;
  const demand = options?.demand ?? true;
  const serverIds = useMemo(() => daemons.map((daemon) => daemon.serverId), [daemons]);
  useEffect(() => {
    if (!demand) return;
    const releases = serverIds.map((serverId) => runtime.acquireDirectoryDemand(serverId));
    return () => releases.forEach((release) => release());
  }, [demand, runtime, serverIds]);
  const subscribeRuntime = useCallback(
    (onStoreChange: () => void) => runtime.subscribeAll(onStoreChange),
    [runtime],
  );
  const getLoadingSnapshot = useCallback(
    () =>
      daemons.some((daemon) => {
        const status =
          runtime.getSnapshot(daemon.serverId)?.agentDirectoryStatus ?? "initial_loading";
        return status === "initial_loading" || status === "revalidating";
      }),
    [daemons, runtime],
  );
  const isLoading = useSyncExternalStore(subscribeRuntime, getLoadingSnapshot, getLoadingSnapshot);

  const sessionAgents = useSessionStore(
    useShallow((state) => {
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

  const projectAgents = useMemo(createAggregatedAgentProjector, []);
  const result = useMemo(() => {
    const tracing = nativePerformanceTrace.isEnabled();
    if (tracing) nativePerformanceTrace.beginSection("clisbot.agents.derive");
    const agents = projectAgents({ sessionAgents, hosts: daemons, includeArchived });
    if (tracing) nativePerformanceTrace.endSection();
    return { agents };
  }, [daemons, includeArchived, projectAgents, sessionAgents]);

  return {
    ...result,
    isLoading,
    isInitialLoad: isLoading && result.agents.length === 0,
    isRevalidating: isLoading && result.agents.length > 0,
    refreshAll,
  };
}
