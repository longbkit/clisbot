import type { StatusBadgeVariant } from "@/components/ui/status-badge";
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
  /** Whether the Hub holds this Host's connection. The app's own connection to
   * a Host is a separate thing (`status`): channels and Automations run over
   * the Hub's, so a Host can be reachable from here and not from there. */
  hubPresence: string;
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
      hubPresence: daemon.presence,
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

/** `cliCommand` is `paseo` for users; the dev runner substitutes this checkout's CLI and home. */
export function buildHubLoginCommand(hubOrigin: string, cliCommand = "paseo"): string {
  return `${cliCommand} hub login ${hubOrigin}`;
}

/** One vocabulary for a Hub Host's state, shared by Settings → Account and the Welcome card. */
export function hubHostStatusPresentation(status: HubHostOnboardingStatus): {
  label: string;
  description: string;
  variant: StatusBadgeVariant;
} {
  if (status === "online") {
    return { label: "Online", description: "Ready for Projects and Agents", variant: "success" };
  }
  if (status === "connecting") {
    return {
      label: "Connecting",
      description: "Paseo is connecting to this Host",
      variant: "muted",
    };
  }
  if (status === "waiting") {
    return {
      label: "Waiting for connection",
      description: hubHostConnectionOfferHint("connected"),
      variant: "muted",
    };
  }
  if (status === "unavailable") {
    return {
      label: "Status unavailable",
      description: hubHostConnectionOfferHint("unavailable"),
      variant: "muted",
    };
  }
  if (status === "offline" || status === "error") {
    return {
      label: status === "offline" ? "Offline" : "Connection failed",
      description: "Paseo can't reach this Host. Reconnect, or check its daemon on that computer:",
      variant: status === "offline" ? "muted" : "error",
    };
  }
  return {
    label: "Registering",
    description: "Paseo is adding this Daemon as a Host",
    variant: "muted",
  };
}

/**
 * A Host with no published connection offer: the status carries the daemon's Hub presence, so map
 * it back before asking for the hint that names the next step.
 */
export function hubHostOfferHint(status: HubHostOnboardingStatus): string {
  return hubHostConnectionOfferHint(status === "waiting" ? "connected" : status);
}
