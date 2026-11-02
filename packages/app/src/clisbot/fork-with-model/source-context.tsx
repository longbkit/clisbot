import { createContext, useContext, useMemo } from "react";
import type { ForkAgentSource } from "@/hooks/use-fork-agent";

/** The agent a fork starts from: what the fork menu's model picker lists and highlights. */
export interface ForkModelSource {
  serverId: string;
  cwd: string | null;
  provider: string;
  modelId: string;
}

const ForkModelSourceContext = createContext<ForkModelSource | null>(null);

export const ForkModelSourceProvider = ForkModelSourceContext.Provider;

export function useForkModelSource(): ForkModelSource | null {
  return useContext(ForkModelSourceContext);
}

/** The value an agent stream provides to its fork menus; null hides "Fork with another model…". */
export function useForkModelSourceOf(
  serverId: string,
  agent: Pick<ForkAgentSource, "provider" | "cwd" | "model" | "runtimeInfo">,
): ForkModelSource | null {
  const { provider, cwd } = agent;
  const modelId = agent.model ?? agent.runtimeInfo?.model ?? "";
  return useMemo(
    () => (provider && serverId ? { serverId, cwd: cwd || null, provider, modelId } : null),
    [cwd, modelId, provider, serverId],
  );
}
