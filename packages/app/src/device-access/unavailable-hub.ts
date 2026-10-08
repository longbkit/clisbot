import { isLoopbackOrigin } from "./loopback-origin";

/**
 * The selected Hub cannot be reached: no session, not loading, and no Hub state at all. A
 * reachable Hub that asks for sign-in still has state.
 */
export function isHubUnreachable(account: {
  signedIn: unknown;
  loading: boolean;
  state: unknown;
  error: string | null;
}): boolean {
  return !account.signedIn && !account.loading && account.state === null && account.error !== null;
}

export interface HubHostRef {
  serverId: string;
  label: string;
}

export interface UnavailableHubHost extends HubHostRef {
  management?: { hubOrigin: string };
}

export interface DetectedHubRef {
  serverId: string;
  /** The Host's own Hub, and it is down (see `isStoppedHostHub`). */
  stopped?: boolean;
  connection?: { hubId: string };
}

/**
 * A Host's own Hub that is down: the Host keeps its loopback address and its last attempt
 * failed. A Hub still starting or briefly reconnecting, and one that revoked the Host, are not.
 */
export function isStoppedHostHub(status: {
  state: string;
  hubOrigin: string | null;
  lastError: string | null;
}): boolean {
  if (!status.hubOrigin || !isLoopbackOrigin(status.hubOrigin)) return false;
  if (status.state === "not_connected") return true;
  return status.state === "reconnecting" && status.lastError !== null;
}

export type UnavailableHub =
  /** Its Host is connected and still belongs to this Hub, which is not running. */
  | { kind: "stopped"; host: HubHostRef }
  /** Its Host is connected but now runs another Hub. */
  | { kind: "replaced"; host: HubHostRef; other: DetectedHubRef }
  /** Its Host is not connected, or no longer runs it; a new Hub can start on `startOn`. */
  | { kind: "hostGone"; ranOn: HubHostRef | null; startOn: HubHostRef | null }
  /** A Hub with its own address (team or hosted) that this device cannot reach. */
  | { kind: "unreachable" };

/**
 * Why the selected Hub cannot be reached, told through the Host it runs on. A personal Hub
 * always runs on a Host, so "where does it run, and is that Host here?" decides the one next
 * step: start it again, use the Hub that replaced it, start a new one, or retry a remote Hub.
 */
export function diagnoseUnavailableHub(input: {
  hubId: string;
  origin?: string;
  hosts: readonly UnavailableHubHost[];
  connectedIds: readonly string[];
  detected: readonly DetectedHubRef[];
  localServerId: string | null;
}): UnavailableHub {
  const ranOn = hubHost(input);
  // A saved origin that does not parse names no Host; it reads as a remote Hub.
  if (!ranOn && input.origin && !isLoopbackOrigin(input.origin)) return { kind: "unreachable" };
  const connected = (serverId: string) => input.connectedIds.includes(serverId);
  if (ranOn && connected(ranOn.serverId)) {
    const relationship = input.detected.find((hub) => hub.serverId === ranOn.serverId);
    const hubId = relationship?.connection?.hubId;
    // A Host learns its Hub's id from the Hub, so while its own Hub is down it names only
    // that Hub's address. It still belongs to it: the Hub stopped.
    if (hubId === input.hubId || (relationship?.stopped === true && hubId === undefined))
      return { kind: "stopped", host: ref(ranOn) };
    if (relationship && hubId) return { kind: "replaced", host: ref(ranOn), other: relationship };
    return { kind: "hostGone", ranOn: ref(ranOn), startOn: ref(ranOn) };
  }
  const startOn =
    input.hosts.find((host) => host.serverId === input.localServerId && connected(host.serverId)) ??
    input.hosts.find((host) => connected(host.serverId));
  return {
    kind: "hostGone",
    ranOn: ranOn ? ref(ranOn) : null,
    startOn: startOn ? ref(startOn) : null,
  };
}

/** The Host enrolled with this Hub: personal Hubs record `hub://<hubId>`, others their origin. */
function hubHost(input: {
  hubId: string;
  origin?: string;
  hosts: readonly UnavailableHubHost[];
  detected: readonly DetectedHubRef[];
}): UnavailableHubHost | undefined {
  const enrolled = input.hosts.find((host) => {
    const hubOrigin = host.management?.hubOrigin;
    return hubOrigin === `hub://${input.hubId}` || (!!input.origin && hubOrigin === input.origin);
  });
  if (enrolled) return enrolled;
  const running = input.detected.find((hub) => hub.connection?.hubId === input.hubId);
  return running ? input.hosts.find((host) => host.serverId === running.serverId) : undefined;
}

function ref(host: HubHostRef): HubHostRef {
  return { serverId: host.serverId, label: host.label };
}
