import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";

/** A Host as the strip sees it. `hubOrigin` is set only for Hosts a shared (non-personal) Hub lists. */
export interface StripHost {
  serverId: string;
  label: string;
  local: boolean;
  status: HostRuntimeConnectionStatus;
  /** The Host has at least one unarchived session: the closest thing to "used". */
  hasSessions: boolean;
  hubOrigin: string | null;
  /**
   * Shown by name: this computer, a Host added directly, or one from a Hub small enough to list.
   * Other Hub Hosts stay summarised by their Hub's entry regardless of recent activity.
   */
  named: boolean;
}

/** A Hub with at most this many Hosts lists them by name; a larger one becomes one entry. */
export const SMALL_HUB_HOSTS = 3;

export type StripHubState = "online" | "setup" | "signIn" | "unreachable" | "connecting";

export interface StripHub {
  origin: string;
  name: string;
  /** A personal Hub's Hosts are listed by name, so it gets no entry of its own. */
  personal: boolean;
  state: StripHubState;
  online: number;
  total: number;
}

export type StripIssue =
  | {
      kind: "host";
      serverId: string;
      label: string;
      status: HostRuntimeConnectionStatus;
      /** The Hub this Host reaches you through; null for a Host you connected directly. */
      hubName: string | null;
    }
  | { kind: "setup" | "signIn" | "unreachable"; origin: string; name: string };

/** How long a first connection may take before the strip calls it a failure. */
export const CONNECT_STALL_MS = 15_000;

/**
 * The runtime keeps retrying a Host it cannot reach and reports "connecting" throughout. The
 * strip calls that a failure once a connection error was seen or the attempt has stalled.
 */
export function effectiveHostStatus(input: {
  status: HostRuntimeConnectionStatus;
  since: number | null;
  lastError: string | null;
  now: number;
}): HostRuntimeConnectionStatus {
  const waiting = input.status === "connecting" || input.status === "idle";
  if (!waiting) return input.status;
  if (input.lastError) return "error";
  if (input.since !== null && input.now - input.since > CONNECT_STALL_MS) return "error";
  return input.status;
}

const isDown = (status: HostRuntimeConnectionStatus) => status === "offline" || status === "error";

/**
 * This computer, then named Hosts by name and identity. Activity and connection changes must
 * never replace a visible slot. Large shared Hubs keep their Hosts inside the Hub entry.
 */
export function pickStripHosts(hosts: readonly StripHost[], limit = 3): StripHost[] {
  const byName = (a: StripHost, b: StripHost) =>
    a.label.localeCompare(b.label) || a.serverId.localeCompare(b.serverId);
  const local = hosts.filter((host) => host.local).sort(byName);
  // Hermes has no Array.prototype.toSorted; filter() already returns a fresh array to sort.
  const others = hosts.filter((host) => !host.local && host.named).sort(byName);
  return [...local, ...others.slice(0, limit)];
}

/** Only what the user can act on: a Host they use that is down, a Hub to sign in to or reach. */
export function connectionIssues(
  hosts: readonly StripHost[],
  hubs: readonly StripHub[],
): StripIssue[] {
  const issues: StripIssue[] = hosts
    .filter((host) => isDown(host.status) && (host.named || host.hasSessions))
    .map((host) => ({
      kind: "host",
      serverId: host.serverId,
      label: host.label,
      status: host.status,
      hubName: hubs.find((hub) => hub.origin === host.hubOrigin)?.name ?? null,
    }));
  for (const hub of hubs)
    if (hub.state === "setup" || hub.state === "signIn" || hub.state === "unreachable")
      issues.push({ kind: hub.state, origin: hub.origin, name: hub.name });
  return issues;
}

interface SessionAgentSource {
  agents: ReadonlyMap<string, { archivedAt?: Date | null }>;
}

const liveAgentsByMap = new WeakMap<object, boolean>();

function hasLiveAgent(agents: SessionAgentSource["agents"]): boolean {
  const cached = liveAgentsByMap.get(agents);
  if (cached !== undefined) return cached;
  let live = false;
  for (const agent of agents.values()) {
    if (agent.archivedAt) continue;
    live = true;
    break;
  }
  liveAgentsByMap.set(agents, live);
  return live;
}

/**
 * Which Hosts have an unarchived session, as one string for a session-store selector: a session
 * update that does not change the set keeps the key, so subscribers do not re-render. Each agent map
 * is scanned once; the store replaces the map when an agent changes.
 */
export function hostsWithSessionsKey(
  sessions: Readonly<Record<string, SessionAgentSource | undefined>>,
): string {
  const serverIds: string[] = [];
  for (const [serverId, session] of Object.entries(sessions)) {
    if (session && hasLiveAgent(session.agents)) serverIds.push(serverId);
  }
  return serverIds.sort().join("\n");
}

export function parseHostsWithSessionsKey(key: string): ReadonlySet<string> {
  return new Set(key ? key.split("\n") : []);
}

export function onlineSummary(hosts: readonly StripHost[]): { online: number; total: number } {
  return {
    online: hosts.filter((host) => host.status === "online").length,
    total: hosts.length,
  };
}

/** The second line under a Hub's name. */
export function hubSubtitle(hub: StripHub): string {
  if (hub.state === "setup") return "Finish setup";
  if (hub.state === "signIn") return "Sign in";
  if (hub.state === "unreachable") return "Unreachable";
  if (hub.state === "connecting") return "Connecting…";
  if (hub.total === 0) return "No Hosts yet";
  return `${hub.online}/${hub.total} online`;
}
