import equal from "fast-deep-equal";
import type { Agent } from "@/stores/session-store";
import type { HostProfile } from "@/types/host-connection";
import type { AggregatedAgent } from "./use-aggregated-agents";

export interface AggregatedAgentSources {
  sessionAgents: Record<string, Map<string, Agent> | undefined>;
  hosts: readonly Pick<HostProfile, "serverId" | "label">[];
  includeArchived: boolean;
}
interface CachedAgent {
  source: Agent;
  serverLabel: string;
  projected: AggregatedAgent;
}

function projectAgent({
  source,
  serverId,
  serverLabel,
}: {
  source: Agent;
  serverId: string;
  serverLabel: string;
}): AggregatedAgent {
  return {
    id: source.id,
    serverId,
    serverLabel,
    title: source.title ?? null,
    status: source.status,
    turn: source.turn,
    lastActivityAt: source.lastActivityAt,
    cwd: source.cwd,
    workspaceId: source.workspaceId,
    provider: source.provider,
    pendingPermissionCount: source.pendingPermissions.length,
    requiresAttention: source.requiresAttention,
    attentionReason: source.attentionReason,
    attentionTimestamp: source.attentionTimestamp,
    archivedAt: source.archivedAt,
    createdAt: source.createdAt,
    labels: source.labels,
    projectPlacement: source.projectPlacement,
  };
}

function compareAgents(left: AggregatedAgent, right: AggregatedAgent): number {
  const leftRunning = left.turn.phase === "open";
  const rightRunning = right.turn.phase === "open";
  if (leftRunning !== rightRunning) return leftRunning ? -1 : 1;
  return right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
}

/** One bounded identity cache per consumer; dropped/archived sources leave the cache. */
export function createAggregatedAgentProjector() {
  let previous = new Map<string, CachedAgent>();
  let sorted: AggregatedAgent[] = [];
  return (input: AggregatedAgentSources): AggregatedAgent[] => {
    const labels = new Map(input.hosts.map((host) => [host.serverId, host.label]));
    const next = new Map<string, CachedAgent>();
    const agents: AggregatedAgent[] = [];
    for (const [serverId, sources] of Object.entries(input.sessionAgents)) {
      if (!sources) continue;
      const label = labels.get(serverId) ?? serverId;
      for (const source of sources.values()) {
        if (!input.includeArchived && source.archivedAt) continue;
        const key = `${serverId}:${source.id}`;
        let entry = previous.get(key);
        // Directory entries are immutable; a Host rename still invalidates its labels.
        if (!entry || entry.source !== source || entry.serverLabel !== label) {
          const projected = projectAgent({ source, serverId, serverLabel: label });
          entry = {
            source,
            serverLabel: label,
            projected: entry && equal(entry.projected, projected) ? entry.projected : projected,
          };
        }
        next.set(key, entry);
        agents.push(entry.projected);
      }
    }
    agents.sort(compareAgents);
    previous = next;
    const unchanged =
      agents.length === sorted.length && agents.every((agent, index) => agent === sorted[index]);
    if (!unchanged) sorted = agents;
    return sorted;
  };
}
