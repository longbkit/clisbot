import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { SourceHealth } from "@/runtime/source-health";

/**
 * What Navigation V2 may show as happening now. A source is a Host.
 *
 * - **Removed**: no longer in the Host registry (its Hub is signed out, or the Host was deleted).
 *   Its sessions are not listed. Nothing stored is cleared; the runtime already drops a removed
 *   Host's replica, and this only keeps a late leftover from being drawn.
 * - **Cached**: still registered but not reachable now (offline, a sign-in lapsed, access
 *   revoked) or not yet answered on this connection. Its sessions stay listed with their last
 *   known facts, but nothing about them is live: not Running, and no approval to give.
 *
 * See docs/features/navigation-v2/README.md#sources-removed-and-cached.
 */

/** The sessions of Hosts still in the registry. Returns `agents` itself when none is dropped. */
export function registeredAgents<T extends { serverId: string }>(
  agents: readonly T[],
  hosts: readonly { serverId: string }[],
): readonly T[] {
  const registered = new Set(hosts.map((host) => host.serverId));
  return agents.every((agent) => registered.has(agent.serverId))
    ? agents
    : agents.filter((agent) => registered.has(agent.serverId));
}

/**
 * Hosts whose sessions are cached. `degraded` is the health summary's list of unreachable
 * sources, which already lets a Hub's sign-in or revocation override its Hosts; a source that is
 * still on its first connection has shown no live directory yet.
 */
export function cachedServerIds(input: {
  entries: readonly SourceHealth[];
  degraded: readonly { serverId: string }[];
}): ReadonlySet<string> {
  const cached = new Set(input.degraded.map((source) => source.serverId));
  for (const entry of input.entries) {
    if (entry.state === "syncing" && !entry.agents.loaded) cached.add(entry.serverId);
  }
  return cached;
}

const quiet = new WeakMap<AggregatedAgent, AggregatedAgent>();

/**
 * A session as its source last reported it, minus what only a live source can say: a running
 * turn and a pending approval. Failures and unread replies are facts and stay.
 */
export function asCachedAgent(agent: AggregatedAgent): AggregatedAgent {
  const running = agent.status === "running" || agent.status === "initializing";
  const asking = (agent.pendingPermissionCount ?? 0) > 0 || agent.attentionReason === "permission";
  if (!running && !asking && agent.turn.phase !== "open") return agent;
  const known = quiet.get(agent);
  if (known) return known;
  const cached: AggregatedAgent = {
    ...agent,
    status: running ? "idle" : agent.status,
    turn: agent.turn.phase === "open" ? { phase: "idle", cancellationRequestId: null } : agent.turn,
    pendingPermissionCount: 0,
    requiresAttention: agent.attentionReason === "permission" ? false : agent.requiresAttention,
    attentionReason: agent.attentionReason === "permission" ? null : agent.attentionReason,
  };
  quiet.set(agent, cached);
  return cached;
}

/** `agents` with the cached sources' sessions made quiet; unchanged rows keep their identity. */
export function quietCachedAgents(
  agents: readonly AggregatedAgent[],
  cached: ReadonlySet<string>,
): readonly AggregatedAgent[] {
  if (cached.size === 0) return agents;
  let changed = false;
  const next = agents.map((agent) => {
    if (!cached.has(agent.serverId)) return agent;
    const quieted = asCachedAgent(agent);
    if (quieted !== agent) changed = true;
    return quieted;
  });
  return changed ? next : agents;
}
