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
    createdBy: source.createdBy,
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

/** The same sources as the last call: the maps are replaced, never mutated, on every update. */
function sameSources(left: AggregatedAgentSources, right: AggregatedAgentSources): boolean {
  if (left.includeArchived !== right.includeArchived) return false;
  if (left.hosts !== right.hosts) {
    if (left.hosts.length !== right.hosts.length) return false;
    const changed = left.hosts.some(
      (host, index) =>
        host.serverId !== right.hosts[index]?.serverId || host.label !== right.hosts[index]?.label,
    );
    if (changed) return false;
  }
  const leftKeys = Object.keys(left.sessionAgents);
  if (leftKeys.length !== Object.keys(right.sessionAgents).length) return false;
  return leftKeys.every((key) => left.sessionAgents[key] === right.sessionAgents[key]);
}

/**
 * A projector that answers a repeat of the same sources from memory. The aggregation hook is
 * mounted by several always-on consumers (Home, Chats, Work, the hosts strip, the favicon); each
 * asks with its own equal-valued inputs, so one store update costs one projection, not one each.
 */
export function createMemoizedAggregatedAgentProjector() {
  const project = createAggregatedAgentProjector();
  let lastInput: AggregatedAgentSources | null = null;
  let lastResult: AggregatedAgent[] = [];
  return (input: AggregatedAgentSources): AggregatedAgent[] => {
    if (lastInput && sameSources(lastInput, input)) return lastResult;
    lastResult = project(input);
    lastInput = input;
    return lastResult;
  };
}

const sharedProjectors = new Map<
  boolean,
  ReturnType<typeof createMemoizedAggregatedAgentProjector>
>();

/** One projector per archived view, shared by every consumer of that view. */
export function sharedAggregatedAgentProjector(includeArchived: boolean) {
  let projector = sharedProjectors.get(includeArchived);
  if (!projector) {
    projector = createMemoizedAggregatedAgentProjector();
    sharedProjectors.set(includeArchived, projector);
  }
  return projector;
}
