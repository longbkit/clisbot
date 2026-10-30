import { BOT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import type { Agent } from "@/stores/session-store";
import type { AggregatedAgentSources } from "./aggregated-agent-projector";

/**
 * A company fleet as the session store holds it: 14 Hub Hosts with ~260 sessions each (about
 * 3,600, the Galaxy S23 report of 2026-10-30), mixed statuses, archived sessions, Bot chats and
 * deliberate timestamp ties across and within Hosts. Deterministic for a seed.
 */
export interface AgentFleet extends AggregatedAgentSources {
  sessionAgents: Record<string, Map<string, Agent>>;
}

/** Counts every `getTime()` the code under test makes: two per timestamp comparison. */
export const timeReads = { count: 0 };

class CountedDate extends Date {
  override getTime(): number {
    timeReads.count += 1;
    return super.getTime();
  }
}

const BASE = Date.parse("2026-10-30T09:00:00Z");
const DAY = 86_400_000;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function fleetAgent({ id, ...overrides }: Partial<Agent> & { id: string }): Agent {
  const at = new CountedDate(BASE);
  return {
    id,
    serverId: "host-0",
    provider: "codex",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt: at,
    updatedAt: at,
    lastActivityAt: at,
    lastUserMessageAt: null,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: id,
    cwd: "/synthetic",
    model: null,
    parentAgentId: null,
    labels: {},
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    ...overrides,
  };
}

/** A timestamp `minutesAgo` before the fixture's clock, counted by `timeReads`. */
export function fleetTime(minutesAgo: number): Date {
  return new CountedDate(BASE - minutesAgo * 60_000);
}

function openTurn(at: Date): Agent["turn"] {
  return {
    phase: "open",
    turnId: `turn-${at.getTime()}`,
    startedAt: at,
    cancellationRequestId: null,
  };
}

function fleetSession(serverId: string, index: number, next: () => number): Agent {
  const roll = next();
  const labels: Record<string, string> = roll < 0.2 ? { [BOT_ID_LABEL]: `bot-${index % 5}` } : {};
  // Every 20th session shares its minute with others on the same Host and on other Hosts.
  const minutes = index % 20 === 0 ? index % 140 : (next() * 30 * DAY) / 60_000;
  const at = fleetTime(Math.floor(minutes));
  const base = {
    id: `agent-${index}`,
    serverId,
    title: `Session ${index}`,
    lastActivityAt: at,
    updatedAt: at,
    createdAt: at,
    workspaceId: `ws-${index % 23}`,
    labels,
  };
  if (roll < 0.03) return fleetAgent({ ...base, status: "running", turn: openTurn(at) });
  if (roll < 0.05)
    return fleetAgent({
      ...base,
      status: "error",
      requiresAttention: true,
      attentionReason: "error",
      attentionTimestamp: at,
    });
  if (roll < 0.06)
    return fleetAgent({
      ...base,
      status: "running",
      turn: openTurn(at),
      requiresAttention: true,
      attentionReason: "permission",
      attentionTimestamp: at,
    });
  if (roll < 0.11)
    return fleetAgent({
      ...base,
      requiresAttention: true,
      attentionReason: "finished",
      attentionTimestamp: at,
    });
  if (roll < 0.21) return fleetAgent({ ...base, archivedAt: at });
  return fleetAgent(base);
}

export function createAgentFleet({
  hosts = 14,
  sessionsPerHost = 260,
  seed = 7,
}: { hosts?: number; sessionsPerHost?: number; seed?: number } = {}): AgentFleet {
  const next = random(seed);
  const sessionAgents: Record<string, Map<string, Agent>> = {};
  const profiles: AgentFleet["hosts"][number][] = [];
  for (let h = 0; h < hosts; h++) {
    const serverId = `host-${h}`;
    profiles.push({ serverId, label: `Sandbox ${h}` });
    const agents = new Map<string, Agent>();
    for (let i = 0; i < sessionsPerHost; i++) {
      const session = fleetSession(serverId, h * sessionsPerHost + i, next);
      agents.set(session.id, session);
    }
    sessionAgents[serverId] = agents;
  }
  return { hosts: profiles, sessionAgents, includeArchived: false };
}

/** The store's update: a new Map for one Host, every other Host's Map kept. */
export function withAgent(fleet: AgentFleet, agent: Agent): AgentFleet {
  const agents = new Map(fleet.sessionAgents[agent.serverId]);
  agents.set(agent.id, agent);
  return { ...fleet, sessionAgents: { ...fleet.sessionAgents, [agent.serverId]: agents } };
}

export function withoutAgent(fleet: AgentFleet, serverId: string, id: string): AgentFleet {
  const agents = new Map(fleet.sessionAgents[serverId]);
  agents.delete(id);
  return { ...fleet, sessionAgents: { ...fleet.sessionAgents, [serverId]: agents } };
}

export function fleetSource(fleet: AgentFleet, serverId: string, id: string): Agent {
  const source = fleet.sessionAgents[serverId]?.get(id);
  if (!source) throw new Error(`No fixture session ${serverId}:${id}`);
  return source;
}

/**
 * A deterministic stream of the updates a fleet sends: new activity, turns opening and
 * closing, failures, approvals, archive and restore, new and deleted sessions, a Host renamed,
 * a Host leaving and coming back, and a Host whose directory arrives reordered.
 */
export function* fleetUpdates(start: AgentFleet, steps: number, seed = 11): Generator<AgentFleet> {
  const next = random(seed);
  let fleet = start;
  let created = 0;
  let parked: [string, Map<string, Agent>] | null = null;
  for (let step = 0; step < steps; step++) {
    const serverIds = Object.keys(fleet.sessionAgents);
    const serverId = serverIds[Math.floor(next() * serverIds.length)]!;
    const ids = [...fleet.sessionAgents[serverId]!.keys()];
    const id = ids[Math.floor(next() * ids.length)];
    const roll = next();
    const now = fleetTime(-step);
    if (!id || roll < 0.05) {
      created += 1;
      fleet = withAgent(fleet, fleetAgent({ id: `new-${created}`, serverId, lastActivityAt: now }));
    } else if (roll < 0.08) {
      fleet = withoutAgent(fleet, serverId, id);
    } else if (roll < 0.09) {
      fleet = {
        ...fleet,
        hosts: fleet.hosts.map((host) =>
          host.serverId === serverId ? { ...host, label: `${host.label}′` } : host,
        ),
      };
    } else if (roll < 0.1 && !parked) {
      const { [serverId]: agents, ...rest } = fleet.sessionAgents;
      parked = [serverId, agents!];
      fleet = { ...fleet, sessionAgents: rest };
    } else if (roll < 0.11 && parked) {
      fleet = { ...fleet, sessionAgents: { ...fleet.sessionAgents, [parked[0]]: parked[1] } };
      parked = null;
    } else if (roll < 0.12) {
      const reordered = new Map([...fleet.sessionAgents[serverId]!].toReversed());
      fleet = { ...fleet, sessionAgents: { ...fleet.sessionAgents, [serverId]: reordered } };
    } else {
      fleet = withAgent(fleet, changed(fleetSource(fleet, serverId, id), roll, now));
    }
    yield fleet;
  }
}

function changed(source: Agent, roll: number, now: Date): Agent {
  if (roll < 0.3) return { ...source, status: "running", turn: openTurn(now), lastActivityAt: now };
  if (roll < 0.5)
    return {
      ...source,
      status: "idle",
      turn: { phase: "idle", cancellationRequestId: null },
      requiresAttention: true,
      attentionReason: "finished",
      attentionTimestamp: now,
      lastActivityAt: now,
    };
  if (roll < 0.6)
    return { ...source, status: "error", requiresAttention: true, attentionReason: "error" };
  if (roll < 0.7) return { ...source, archivedAt: source.archivedAt ? null : now };
  if (roll < 0.8) return { ...source, title: `${source.title} (edited)` };
  // A tie: the same activity time as the session it came from.
  if (roll < 0.9) return { ...source, lastActivityAt: source.createdAt };
  return { ...source, updatedAt: now };
}
