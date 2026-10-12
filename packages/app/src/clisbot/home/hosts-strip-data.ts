import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import { useHubAccounts, type HubAccountContextValue } from "@/clisbot/hub/account-provider";
import { buildHubSettingsRoute } from "@/clisbot/hub/navigation";
import { selectHubProfile, useHubProfiles } from "@/device-access/hub-profiles";
import { isHubUnreachable } from "@/device-access/unavailable-hub";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import {
  getHostRuntimeConnectionStatusSince,
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  type HostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import {
  SMALL_HUB_HOSTS,
  connectionIssues,
  effectiveHostStatus,
  onlineSummary,
  pickStripHosts,
  type StripHost,
  type StripHub,
  type StripHubState,
} from "./hosts-strip-model";

function hubState(account: HubAccountContextValue): StripHubState {
  if (account.signedIn) return "online";
  if (account.state?.status === "instanceSetupRequired") return "setup";
  if (isHubUnreachable(account)) return "unreachable";
  if (account.loading || !account.state) return "connecting";
  return "signIn";
}

/** Connection status per Host, with stalled first connections turned into failures. */
function useEffectiveStatuses(
  serverIds: readonly string[],
): ReadonlyMap<string, HostRuntimeConnectionStatus> {
  const statuses = useHostRuntimeConnectionStatuses(serverIds);
  const [now, setNow] = useState(() => Date.now());
  const waiting = serverIds.filter((id) => {
    const status = statuses.get(id);
    return status === "connecting" || status === "idle";
  });
  const waitingKey = waiting.join("\n");
  useEffect(() => {
    if (!waitingKey) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [waitingKey]);
  return useMemo(() => {
    const store = getHostRuntimeStore();
    return new Map(
      serverIds.map((id) => [
        id,
        effectiveHostStatus({
          status: statuses.get(id) ?? "connecting",
          since: getHostRuntimeConnectionStatusSince(id),
          lastError: store.getSnapshot(id)?.lastError ?? null,
          now,
        }),
      ]),
    );
  }, [serverIds, statuses, now]);
}

/** Every Host and Hub this device knows, reduced to what the Home strip shows. */
export function useHostsStrip() {
  const hosts = useAvailableHosts();
  const localServerId = useLocalDaemonServerId();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const statuses = useEffectiveStatuses(serverIds);
  // Home already loads the directory; the strip only reads it.
  const { agents } = useAggregatedAgents({ demand: false });
  const accounts = useHubAccounts();
  const { profiles } = useHubProfiles();
  return useMemo(() => {
    const personal = new Set(
      accounts
        .filter((account) => account.connection?.accountAuthentication === "personal")
        .map((account) => account.origin),
    );
    const latest = new Map<string, number>();
    for (const agent of agents) {
      const at = agent.lastActivityAt.getTime();
      if (at > (latest.get(agent.serverId) ?? 0)) latest.set(agent.serverId, at);
    }
    const hubSize = new Map<string, number>();
    for (const host of hosts) {
      const origin = host.management?.hubOrigin;
      if (origin) hubSize.set(origin, (hubSize.get(origin) ?? 0) + 1);
    }
    const stripHosts: StripHost[] = hosts.map((host) => {
      const origin = host.management?.hubOrigin ?? null;
      const hubOrigin = origin && !personal.has(origin) ? origin : null;
      const local = host.serverId === localServerId;
      return {
        serverId: host.serverId,
        label: host.label,
        local,
        status: statuses.get(host.serverId) ?? "connecting",
        lastActivity: latest.get(host.serverId) ?? null,
        hubOrigin,
        named: local || !hubOrigin || (hubSize.get(hubOrigin) ?? 0) <= SMALL_HUB_HOSTS,
      };
    });
    const hubs: StripHub[] = accounts.flatMap((account) => {
      const origin = account.origin;
      if (!account.enabled || !origin) return [];
      const listed = stripHosts.filter((host) => host.hubOrigin === origin);
      const profile = profiles.find((entry) => `hub://${entry.hubId}` === origin);
      return {
        origin,
        name: account.signedIn?.organization.name ?? profile?.label ?? "Hub",
        personal: personal.has(origin),
        state: hubState(account),
        online: listed.filter((host) => host.status === "online").length,
        total: listed.length,
      };
    });
    return {
      entries: pickStripHosts(stripHosts),
      hubs: hubs.filter((hub) => !hub.personal),
      issues: connectionIssues(stripHosts, hubs),
      summary: onlineSummary(stripHosts),
    };
  }, [hosts, localServerId, statuses, agents, accounts, profiles]);
}

/** Opens a Hub's settings, selecting that Hub first so the page shows the right one. */
export function useOpenHub() {
  const router = useRouter();
  const { profiles } = useHubProfiles();
  const accounts = useHubAccounts();
  return useCallback(
    async (origin: string, destination: "hosts" | "account" | "hubs" | "retry") => {
      // Retry re-reads the Hub in place; every other destination is that Hub's settings page.
      if (destination === "retry") {
        await accounts.find((account) => account.origin === origin)?.refresh();
        return;
      }
      const profile = profiles.find((entry) => `hub://${entry.hubId}` === origin);
      if (profile) await selectHubProfile(profile.hubId);
      router.push(buildHubSettingsRoute(destination));
    },
    [accounts, profiles, router],
  );
}
