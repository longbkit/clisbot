import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";

/** A Host as the strip sees it. `hubOrigin` is set only for Hosts a shared (non-personal) Hub lists. */
export interface StripHost {
  serverId: string;
  label: string;
  local: boolean;
  status: HostRuntimeConnectionStatus;
  /** Latest agent activity on this Host, ms since epoch; the closest thing to "last used". */
  lastActivity: number | null;
  hubOrigin: string | null;
  /**
   * Shown by name: this computer, a Host added directly, or one from a Hub small enough to list.
   * Other Hub Hosts are summarised by their Hub's entry unless you used them.
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
 * Hosts shown by name: this computer, then the Hosts you used most recently, then ones you added
 * yourself. A shared Hub's other Hosts are summarised by that Hub's entry, so a Hub with a hundred
 * Hosts never turns into a hundred entries.
 */
export function pickStripHosts(hosts: readonly StripHost[], limit = 3): StripHost[] {
  const local = hosts.filter((host) => host.local);
  const others = hosts
    .filter((host) => !host.local && (host.lastActivity !== null || host.named))
    .toSorted(
      (a, b) =>
        (b.lastActivity ?? 0) - (a.lastActivity ?? 0) ||
        Number(b.status === "online") - Number(a.status === "online") ||
        a.label.localeCompare(b.label),
    );
  return [...local, ...others.slice(0, limit)];
}

/** Only what the user can act on: a Host they use that is down, a Hub to sign in to or reach. */
export function connectionIssues(
  hosts: readonly StripHost[],
  hubs: readonly StripHub[],
): StripIssue[] {
  const issues: StripIssue[] = hosts
    .filter((host) => isDown(host.status) && (host.named || host.lastActivity !== null))
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
