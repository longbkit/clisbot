import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { SourceState } from "@/runtime/source-health";

/**
 * What Navigation V2 may show as happening now. A source is a Host.
 *
 * - **Not listable**: registered, but the Host picker does not list it either (a Hub-managed Host
 *   that no Hub account here lists, or whose Hub answered that this device is signed out), or no
 *   longer registered. Its sessions are not listed. Nothing stored is cleared. Until the registry,
 *   every Hub and the remembered Hub lists have all loaded this cannot be judged, so nothing is
 *   hidden: work that is valid offline must not disappear during a cold start.
 * - **Cached**: listable but not reachable now (offline, a sign-in lapsed, access revoked), not
 *   yet answered on this connection, or not yet measured. Its sessions stay listed with their
 *   last known facts, but nothing live is claimed: not Running, no approval to give, and not
 *   "Done" either, because what a cached session was doing is unknown, not finished.
 *
 * See docs/features/navigation-v2/README.md#sources-removed-and-cached.
 */

/**
 * The Hosts whose sessions may be listed: the picker's own list once it can be judged, else every
 * registered Host.
 */
export function listableServerIds(input: {
  registered: readonly string[];
  inventory: readonly string[];
  settled: boolean;
}): ReadonlySet<string> {
  return new Set(input.settled ? input.inventory : input.registered);
}

/** The sessions of listable Hosts. Returns `agents` itself when none is dropped. */
export function listedAgents<T extends { serverId: string }>(
  agents: readonly T[],
  listable: ReadonlySet<string>,
): readonly T[] {
  return agents.every((agent) => listable.has(agent.serverId))
    ? agents
    : agents.filter((agent) => listable.has(agent.serverId));
}

/** One source as its health reads after a Hub's sign-in or revocation has overridden it. */
export interface SourceStatusLike {
  serverId: string;
  effectiveState: SourceState;
  agents: { loaded: boolean };
}

/**
 * Whether a source's sessions are cached. Offline, a lapsed sign-in and revoked access are not
 * live; a source still on its first connection has shown no live directory; one with no health
 * entry yet has not been measured. None of those is live.
 */
export function isCachedSource(status: SourceStatusLike | null | undefined): boolean {
  if (!status) return true;
  if (status.effectiveState === "live") return false;
  if (status.effectiveState === "syncing") return !status.agents.loaded;
  return true;
}

/** The listable Hosts whose sessions are cached. */
export function cachedServerIds(input: {
  statuses: readonly SourceStatusLike[];
  listable: ReadonlySet<string>;
}): ReadonlySet<string> {
  const byId = new Map(input.statuses.map((status) => [status.serverId, status]));
  return new Set([...input.listable].filter((serverId) => isCachedSource(byId.get(serverId))));
}

/** The facts a status is read from; `status` is a plain string so any agent shape fits. */
export interface LiveFacts {
  status: string;
  pendingPermissionCount?: number;
  requiresAttention?: boolean | null;
  attentionReason?: "finished" | "error" | "permission" | null;
}

/**
 * `facts` minus what only a live source can say: a running turn and a pending approval. Returns
 * `facts` itself when it holds none. Failures and unread replies are history and stay.
 */
export function withoutLiveFacts<T extends LiveFacts>(facts: T): T {
  const running = facts.status === "running" || facts.status === "initializing";
  const asking = (facts.pendingPermissionCount ?? 0) > 0 || facts.attentionReason === "permission";
  if (!running && !asking) return facts;
  return {
    ...facts,
    status: running ? "idle" : facts.status,
    pendingPermissionCount: 0,
    requiresAttention: facts.attentionReason === "permission" ? false : facts.requiresAttention,
    attentionReason: facts.attentionReason === "permission" ? null : facts.attentionReason,
  };
}

const quiet = new WeakMap<AggregatedAgent, AggregatedAgent>();
const unverified = new WeakSet<AggregatedAgent>();

/** Whether `agent` is a cached copy whose live state was dropped (so it is unknown, not done). */
export function isCachedAgent(agent: AggregatedAgent): boolean {
  return unverified.has(agent);
}

/** A session as its source last reported it, minus its live facts (see `withoutLiveFacts`). */
export function asCachedAgent(agent: AggregatedAgent): AggregatedAgent {
  const known = quiet.get(agent);
  if (known) return known;
  const facts = withoutLiveFacts(agent);
  const open = agent.turn.phase === "open";
  if (facts === agent && !open) return agent;
  const cached: AggregatedAgent = {
    ...facts,
    turn: open ? { phase: "idle", cancellationRequestId: null } : agent.turn,
  };
  quiet.set(agent, cached);
  unverified.add(cached);
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
