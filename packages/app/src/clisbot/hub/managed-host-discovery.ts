export const HUB_HOST_DISCOVERY_INTERVAL_MS = 2_000;
export const HUB_HOST_DISCOVERY_WINDOW_MS = 60_000;

interface HostReference {
  serverId: string;
}

export interface DaemonReference {
  id: string;
  connectionOffer: { serverId: string } | null;
}

export function findNewlyEnrolledHost<T extends HostReference>(input: {
  hosts: readonly T[];
  daemons: readonly DaemonReference[];
  baseline: readonly DaemonReference[];
}): T | undefined {
  // A previously registered daemon with no offer can finish enrollment too.
  // Never infer enrollment from an unchanged existing offer or an unrelated heartbeat.
  for (const daemon of input.daemons) {
    if (daemon.connectionOffer === null) continue;
    const previous = input.baseline.find((candidate) => candidate.id === daemon.id);
    if (previous?.connectionOffer) continue;
    const host = input.hosts.find(
      (candidate) => candidate.serverId === daemon.connectionOffer?.serverId,
    );
    if (host !== undefined) return host;
  }
  return undefined;
}

export function hubHostDiscoveryRefetchInterval(input: {
  deadline: number;
  now: number;
  hostDiscovered: boolean;
}): number | false {
  return !input.hostDiscovered && input.now < input.deadline
    ? HUB_HOST_DISCOVERY_INTERVAL_MS
    : false;
}
