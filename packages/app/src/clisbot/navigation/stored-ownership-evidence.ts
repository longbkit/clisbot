import { useSessionStore, type Agent } from "@/stores/session-store";
import { agentOwnershipEvidence } from "./ownership-inheritance";

/**
 * `agentOwnershipEvidence` against the Host's agents as the store holds them now, for surfaces
 * that hold one session but not its Host's map. Their filters are rebuilt when the Work index
 * changes, which it does when a parent's evidence moves (work-filter.ts).
 */
export function storedAgentOwnershipEvidence(agent: Agent) {
  return agentOwnershipEvidence(agent, useSessionStore.getState().sessions[agent.serverId]?.agents);
}
