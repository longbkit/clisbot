import { useEffect, useMemo, useState } from "react";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import { useHubAccounts } from "@/clisbot/hub/account-provider";
import { effectiveHostStatus } from "@/clisbot/home/hosts-strip-model";
import { hubProfileOrigin, useHubProfiles } from "@/device-access/hub-profiles";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import {
  getHostRuntimeConnectionStatusSince,
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
} from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import type { ProjectSummary } from "@/utils/projects";
import {
  buildSearchScopeCatalog,
  type ScopeAgentInput,
  type ScopeHostInput,
  type ScopeHostStatus,
  type ScopeProjectInput,
  type SearchScopeCatalog,
} from "./catalog";

const NO_HOSTS: HostProfile[] = [];

/** The host part of a `host:port` endpoint, so typing an address finds the Host. */
function hostnamesOf(host: HostProfile): string[] {
  const names: string[] = [];
  for (const connection of host.connections) {
    if (connection.type === "remoteSsh") names.push(connection.host);
    if (connection.type === "directTcp") {
      const name = connection.endpoint.replace(/^\[|\](:\d+)?$/g, "").replace(/:\d+$/, "");
      if (name && name !== "localhost" && name !== "127.0.0.1") names.push(name);
    }
  }
  return names;
}

function toScopeStatus(serverId: string, status: string | undefined, now: number): ScopeHostStatus {
  const effective = effectiveHostStatus({
    status: (status ?? "connecting") as Parameters<typeof effectiveHostStatus>[0]["status"],
    since: getHostRuntimeConnectionStatusSince(serverId),
    lastError: getHostRuntimeStore().getSnapshot(serverId)?.lastError ?? null,
    now,
  });
  if (effective === "online") return "online";
  return effective === "offline" || effective === "error" ? "offline" : "connecting";
}

/** Hub origin → display name, and the origins of personal Hubs (their Hosts are listed by name). */
function useHubNames() {
  const accounts = useHubAccounts();
  const { profiles } = useHubProfiles();
  return useMemo(() => {
    const names = new Map<string, string>();
    const personal = new Set<string>();
    for (const account of accounts) {
      if (!account.origin) continue;
      const profile = profiles.find((entry) => hubProfileOrigin(entry) === account.origin);
      names.set(account.origin, account.signedIn?.organization.name ?? profile?.label ?? "Hub");
      if (account.connection?.accountAuthentication === "personal") personal.add(account.origin);
    }
    return { names, personal };
  }, [accounts, profiles]);
}

/** How often a Host still connecting is re-judged, as the Home strip does. */
const STALL_TICK_MS = 5000;

/**
 * The runtime reports an unreachable Host as "connecting" while it retries. Re-judge waiting
 * Hosts on a slow tick so one that has stalled reads Offline without anyone typing.
 */
function useStallClock(statuses: ReadonlyMap<string, string>, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  const waiting = enabled && [...statuses.values()].some((s) => s === "connecting" || s === "idle");
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), STALL_TICK_MS);
    return () => clearInterval(timer);
  }, [waiting]);
  return now;
}

function useScopeHosts(enabled: boolean): ScopeHostInput[] {
  const available = useAvailableHosts();
  const hosts = enabled ? available : NO_HOSTS;
  const localServerId = useLocalDaemonServerId();
  const hubs = useHubNames();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const statuses = useHostRuntimeConnectionStatuses(serverIds);
  const now = useStallClock(statuses, enabled);
  return useMemo(() => {
    const store = getHostRuntimeStore();
    return hosts.map((host) => {
      const origin = host.management?.hubOrigin ?? null;
      return {
        serverId: host.serverId,
        label: host.label,
        local: host.serverId === localServerId,
        hubOrigin: origin && !hubs.personal.has(origin) ? origin : null,
        hubName: origin ? (hubs.names.get(origin) ?? null) : null,
        hostnames: [...hostnamesOf(host), host.management?.daemonSlug ?? ""].filter(Boolean),
        status: toScopeStatus(host.serverId, statuses.get(host.serverId), now),
        lastOnlineAt: store.getSnapshot(host.serverId)?.lastOnlineAt ?? null,
      };
    });
  }, [hosts, hubs, localServerId, now, statuses]);
}

function toProjectInputs(projects: readonly ProjectSummary[]): ScopeProjectInput[] {
  return projects.flatMap((project) =>
    project.hosts.map((host) => ({
      viewKey: project.viewKey,
      serverId: host.serverId,
      projectName: host.projectName || project.projectName,
      customName: host.projectCustomName,
      repoRoot: host.repoRoot,
      workspaceIds: host.workspaces.map((workspace) => workspace.id),
    })),
  );
}

function toAgentInputs(agents: readonly AggregatedAgent[]): ScopeAgentInput[] {
  return agents.map((agent) => ({
    serverId: agent.serverId,
    workspaceId: agent.workspaceId ?? null,
    cwd: agent.cwd,
    placementProjectName: agent.projectPlacement?.projectName ?? null,
  }));
}

/**
 * Hosts, Hubs and Projects the user can see, rebuilt when the directory or a Host's status
 * changes — not per keystroke. Hosts come from the same inventory as the Home strip, so a Host a
 * Hub no longer lists, or one whose access was revoked, leaves search with it.
 */
export function useSearchScopeCatalog(input: {
  enabled: boolean;
  projects: readonly ProjectSummary[];
  agents: readonly AggregatedAgent[];
}): SearchScopeCatalog | null {
  const hosts = useScopeHosts(input.enabled);
  const signedInHubs = useSignedInHubs();
  return useMemo(() => {
    if (!input.enabled) return null;
    return buildSearchScopeCatalog({
      hosts,
      projects: toProjectInputs(input.projects),
      agents: toAgentInputs(input.agents),
      signedInHubs,
    });
  }, [hosts, input.agents, input.enabled, input.projects, signedInHubs]);
}

/** Hubs signed in on this device, named as the Hub settings name them. */
function useSignedInHubs(): readonly { origin: string; name: string }[] {
  const accounts = useHubAccounts();
  return useMemo(
    () =>
      accounts.flatMap((account) =>
        account.signedIn && account.origin
          ? [{ origin: account.origin, name: account.signedIn.organization.name }]
          : [],
      ),
    [accounts],
  );
}
