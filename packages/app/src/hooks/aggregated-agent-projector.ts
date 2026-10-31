import { participationKeyOf } from "@/clisbot/navigation/ownership-key";
import equal from "fast-deep-equal";
import type { Agent } from "@/stores/session-store";
import type { HostProfile } from "@/types/host-connection";
import type { AggregatedAgent } from "./use-aggregated-agents";
import { applyOrderedChanges } from "./aggregated-agent-order";

export interface AggregatedAgentSources {
  sessionAgents: Record<string, Map<string, Agent> | undefined>;
  hosts: readonly Pick<HostProfile, "serverId" | "label">[];
  includeArchived: boolean;
}
/** One session as last seen: its source, where its Map put it, and the row shown for it. */
interface CachedAgent {
  source: Agent;
  /** Map position: arrival order within the Host, renumbered when a directory reorders. */
  seq: number;
  /** Null while archived sessions are hidden. */
  projected: AggregatedAgent | null;
}

/** One Host as last seen. Its rows are recomputed only when its Map or its label changes. */
interface HostSlice {
  sources: ReadonlyMap<string, Agent>;
  label: string;
  /** Position among the store's Hosts, which is the order of equal timestamps across Hosts. */
  rank: number;
  agents: Map<string, CachedAgent>;
}

/** The rows one projection call removed and added; a changed row appears in both. */
interface RowChanges {
  removed: AggregatedAgent[];
  added: AggregatedAgent[];
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
    participationKey: participationKeyOf(source),
  };
}

function compareAgents(left: AggregatedAgent, right: AggregatedAgent): number {
  const leftRunning = left.turn.phase === "open";
  const rightRunning = right.turn.phase === "open";
  if (leftRunning !== rightRunning) return leftRunning ? -1 : 1;
  return right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
}

interface ProjectionState {
  hosts: Map<string, HostSlice>;
  /** Where each shown row sits among equal timestamps. */
  positions: Map<AggregatedAgent, { rank: number; seq: number }>;
  sorted: AggregatedAgent[];
  includeArchived: boolean;
  counter: number;
}

/** Thrown inside a pass when the store's Host or Map order moved; the pass starts again. */
class OrderMoved extends Error {}

/**
 * One bounded identity cache per consumer; dropped/archived sources leave the cache.
 *
 * Incremental: a Host whose Map and label did not change is skipped, a changed Host is compared
 * by reference to find the sessions that changed, and only their rows move in the sorted list.
 * Equal timestamps keep the order a full sort of the store gave them: Host order, then each
 * Host's Map order. When either order moves, the pass renumbers everything, keeping every row
 * whose content did not change.
 */
export function createAggregatedAgentProjector() {
  let state = emptyState(false);
  return (input: AggregatedAgentSources): AggregatedAgent[] => {
    if (input.includeArchived !== state.includeArchived) state = renumbered(state, input);
    const changes: RowChanges = { removed: [], added: [] };
    try {
      syncHosts(state, input, changes);
    } catch (error) {
      if (!(error instanceof OrderMoved)) throw error;
      state = renumbered(state, input);
      return state.sorted;
    }
    applyChanges(state, changes);
    return state.sorted;
  };
}

function emptyState(includeArchived: boolean): ProjectionState {
  return { hosts: new Map(), positions: new Map(), sorted: [], includeArchived, counter: 0 };
}

/** A fresh numbering of `input` that reuses `previous`'s rows, and its sorted array if unchanged. */
function renumbered(previous: ProjectionState, input: AggregatedAgentSources): ProjectionState {
  const state = emptyState(input.includeArchived);
  const changes: RowChanges = { removed: [], added: [] };
  syncHosts(state, input, changes, previous.hosts);
  applyChanges(state, changes);
  if (sameRows(state.sorted, previous.sorted)) state.sorted = previous.sorted;
  return state;
}

function sameRows(left: readonly AggregatedAgent[], right: readonly AggregatedAgent[]): boolean {
  return left.length === right.length && left.every((row, index) => row === right[index]);
}

function syncHosts(
  state: ProjectionState,
  input: AggregatedAgentSources,
  changes: RowChanges,
  inherited?: ReadonlyMap<string, HostSlice>,
): void {
  const labels = new Map(input.hosts.map((host) => [host.serverId, host.label]));
  let lastRank = -1;
  for (const [serverId, sources] of Object.entries(input.sessionAgents)) {
    if (!sources) continue;
    let slice = state.hosts.get(serverId);
    if (slice && slice.rank < lastRank) throw new OrderMoved();
    if (!slice) {
      slice = { sources: new Map(), label: "", rank: ++state.counter, agents: new Map() };
      state.hosts.set(serverId, slice);
    }
    lastRank = slice.rank;
    const label = labels.get(serverId) ?? serverId;
    // Directory entries are immutable and Maps are replaced; a Host rename relabels its rows.
    if (slice.sources === sources && slice.label === label) continue;
    syncHost(
      state,
      { serverId, slice, sources, label, inherited: inherited?.get(serverId) },
      changes,
    );
  }
  for (const [serverId, slice] of state.hosts) {
    if (input.sessionAgents[serverId]) continue;
    for (const entry of slice.agents.values())
      if (entry.projected) changes.removed.push(entry.projected);
    state.hosts.delete(serverId);
  }
}

interface HostSync {
  serverId: string;
  slice: HostSlice;
  sources: ReadonlyMap<string, Agent>;
  label: string;
  /** The same Host before a renumbering, whose unchanged rows are kept. */
  inherited: HostSlice | undefined;
}

function syncHost(state: ProjectionState, sync: HostSync, changes: RowChanges): void {
  const { slice, sources } = sync;
  const relabel = slice.label !== sync.label;
  const known = slice.agents.size;
  let seen = 0;
  let lastSeq = -1;
  for (const source of sources.values()) {
    let entry = slice.agents.get(source.id);
    if (entry) {
      seen += 1;
      if (entry.seq < lastSeq) throw new OrderMoved();
      if (entry.source !== source || relabel) updateRow(state, sync, entry, source, changes);
    } else {
      const inherited = sync.inherited?.agents.get(source.id);
      const reusable = inherited && { ...inherited, label: sync.inherited!.label };
      const projected = projectRow(state, sync, source, reusable);
      entry = { source, seq: ++state.counter, projected };
      slice.agents.set(source.id, entry);
      if (projected) addRow(state, slice, entry, changes);
    }
    lastSeq = entry.seq;
  }
  if (seen < known) dropDeleted(slice, sources, changes);
  slice.sources = sources;
  slice.label = sync.label;
}

function dropDeleted(slice: HostSlice, sources: ReadonlyMap<string, Agent>, changes: RowChanges) {
  for (const [id, entry] of slice.agents) {
    if (sources.has(id)) continue;
    if (entry.projected) changes.removed.push(entry.projected);
    slice.agents.delete(id);
  }
}

/** A row seen before (or before a renumbering), with the label it was projected under. */
interface ReusableRow {
  source: Agent;
  label: string;
  projected: AggregatedAgent | null;
}

/** The row `source` shows, or null while archived rows are hidden; unchanged content keeps its object. */
function projectRow(
  state: ProjectionState,
  sync: HostSync,
  source: Agent,
  reusable: ReusableRow | undefined,
): AggregatedAgent | null {
  if (!state.includeArchived && source.archivedAt) return null;
  const previous = reusable?.projected ?? null;
  if (previous && reusable!.source === source && reusable!.label === sync.label) return previous;
  const next = projectAgent({ source, serverId: sync.serverId, serverLabel: sync.label });
  return previous && equal(previous, next) ? previous : next;
}

function updateRow(
  state: ProjectionState,
  sync: HostSync,
  entry: CachedAgent,
  source: Agent,
  changes: RowChanges,
): void {
  const previous = entry.projected;
  const next = projectRow(state, sync, source, { ...entry, label: sync.slice.label });
  entry.source = source;
  if (next === previous) return;
  if (previous) changes.removed.push(previous);
  entry.projected = next;
  if (next) addRow(state, sync.slice, entry, changes);
}

function addRow(state: ProjectionState, slice: HostSlice, entry: CachedAgent, changes: RowChanges) {
  const row = entry.projected!;
  state.positions.set(row, { rank: slice.rank, seq: entry.seq });
  changes.added.push(row);
}

function applyChanges(state: ProjectionState, changes: RowChanges): void {
  const { positions } = state;
  function compareRows(left: AggregatedAgent, right: AggregatedAgent): number {
    const byActivity = compareAgents(left, right);
    if (byActivity !== 0) return byActivity;
    const a = positions.get(left)!;
    const b = positions.get(right)!;
    return a.rank - b.rank || a.seq - b.seq;
  }
  state.sorted = applyOrderedChanges(state.sorted, changes, compareRows);
  for (const row of changes.removed) positions.delete(row);
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
