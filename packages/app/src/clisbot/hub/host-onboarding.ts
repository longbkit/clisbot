import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";

export type HubHostOnboardingStatus =
  | "waiting"
  | "unavailable"
  | "registering"
  | "connecting"
  | "online"
  | "offline"
  | "error";

interface DaemonProjectionInput {
  id: string;
  slug: string;
  canManage: boolean;
  presence: string;
  connectionOffer: { serverId: string } | null;
}

interface HostProjectionInput {
  serverId: string;
  label: string;
}

export interface HubHostOnboardingItem {
  daemonId: string;
  daemonSlug: string;
  label: string;
  serverId: string | null;
  status: HubHostOnboardingStatus;
  canManage: boolean;
}

export function projectHubHostOnboarding(input: {
  daemons: readonly DaemonProjectionInput[];
  hosts: readonly HostProjectionInput[];
  connectionStatuses: ReadonlyMap<string, HostRuntimeConnectionStatus>;
}): HubHostOnboardingItem[] {
  return input.daemons.map((daemon) => {
    const serverId = daemon.connectionOffer?.serverId ?? null;
    const host =
      serverId === null
        ? undefined
        : input.hosts.find((candidate) => candidate.serverId === serverId);
    return {
      daemonId: daemon.id,
      daemonSlug: daemon.slug,
      label: host?.label ?? daemon.slug,
      serverId,
      canManage: daemon.canManage,
      status: daemonOnboardingStatus(daemon, host, input.connectionStatuses),
    };
  });
}

function daemonOnboardingStatus(
  daemon: DaemonProjectionInput,
  host: HostProjectionInput | undefined,
  connectionStatuses: ReadonlyMap<string, HostRuntimeConnectionStatus>,
): HubHostOnboardingStatus {
  if (daemon.connectionOffer === null) {
    if (daemon.presence === "connected") return "waiting";
    return daemon.presence === "offline" ? "offline" : "unavailable";
  }
  if (host === undefined) return "registering";
  return hostOnboardingStatus(connectionStatuses.get(host.serverId));
}

export function hubHostConnectionOfferHint(presence: string): string {
  if (presence === "offline") {
    return "This Host is not connected to Hub. Start Paseo on that computer and check paseo hub status, then refresh Hosts.";
  }
  if (presence === "connected") {
    return "This Host is connected to Hub but has not shared connection details. Check that relay is enabled on that computer, then refresh Hosts.";
  }
  return "This Host's connection status is unavailable. Check paseo hub status on that computer, then refresh Hosts.";
}

function hostOnboardingStatus(
  status: HostRuntimeConnectionStatus | undefined,
): HubHostOnboardingStatus {
  return status === "online" || status === "offline" || status === "error" ? status : "connecting";
}

export function buildHubLoginCommand(hubOrigin: string): string {
  return `paseo hub login ${hubOrigin}`;
}
