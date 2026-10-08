import type { StatusBadgeVariant } from "@/components/ui/status-badge";
import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { i18n } from "@/i18n/i18next";

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
    return i18n.t("hub.account.hostStatus.offerOffline");
  }
  if (presence === "connected") {
    return i18n.t("hub.account.hostStatus.offerConnected");
  }
  return i18n.t("hub.account.hostStatus.offerUnavailable");
}

function hostOnboardingStatus(
  status: HostRuntimeConnectionStatus | undefined,
): HubHostOnboardingStatus {
  return status === "online" || status === "offline" || status === "error" ? status : "connecting";
}

/** `cliCommand` is `clisbot` for users; the dev runner substitutes this checkout's CLI and home. */
export function buildHubConnectCommand(hubOrigin: string, cliCommand = "clisbot"): string {
  return `${cliCommand} hub connect ${hubOrigin}`;
}

/** One vocabulary for a Hub Host's state, shared by Settings → Account and the Welcome card. */
export function hubHostStatusPresentation(status: HubHostOnboardingStatus): {
  label: string;
  description: string;
  variant: StatusBadgeVariant;
} {
  if (status === "online") {
    return {
      label: i18n.t("hub.account.hostStatus.online"),
      description: i18n.t("hub.account.hostStatus.onlineDescription"),
      variant: "success",
    };
  }
  if (status === "connecting") {
    return {
      label: i18n.t("hub.account.hostStatus.connecting"),
      description: i18n.t("hub.account.hostStatus.connectingDescription"),
      variant: "muted",
    };
  }
  if (status === "waiting") {
    return {
      label: i18n.t("hub.account.hostStatus.waiting"),
      description: hubHostConnectionOfferHint("connected"),
      variant: "muted",
    };
  }
  if (status === "unavailable") {
    return {
      label: i18n.t("hub.account.hostStatus.unavailable"),
      description: hubHostConnectionOfferHint("unavailable"),
      variant: "muted",
    };
  }
  if (status === "offline" || status === "error") {
    return {
      label:
        status === "offline"
          ? i18n.t("hub.account.hostStatus.offline")
          : i18n.t("hub.account.hostStatus.failed"),
      description: i18n.t("hub.account.hostStatus.unreachableDescription"),
      variant: status === "offline" ? "muted" : "error",
    };
  }
  return {
    label: i18n.t("hub.account.hostStatus.registering"),
    description: i18n.t("hub.account.hostStatus.registeringDescription"),
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
