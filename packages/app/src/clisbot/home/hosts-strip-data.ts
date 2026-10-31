import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "expo-router";
import { useAvailableHosts } from "@/clisbot/hub/host-inventory";
import { useHubAccounts, type HubAccountContextValue } from "@/clisbot/hub/account-provider";
import { buildHubSettingsRoute } from "@/clisbot/hub/navigation";
import { selectHubProfile, useHubProfiles } from "@/device-access/hub-profiles";
import { isHubUnreachable } from "@/device-access/unavailable-hub";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useSessionStore } from "@/stores/session-store";
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
  hostsWithSessionsKey,
  onlineSummary,
  parseHostsWithSessionsKey,
  pickStripHosts,
  type StripHost,
  type StripHub,
  type StripHubState,
} from "./hosts-strip-model";
import { useStallNow, type WaitingHost } from "./connect-stall-clock";

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
  const waitingKey = useWaitingKey(serverIds);
  const waiting = useMemo(() => parseWaitingKey(waitingKey), [waitingKey]);
  const now = useStallNow([...waiting.values()]);
  return useMemo(
    () =>
      new Map(
        serverIds.map((id) => {
          const host = waiting.get(id);
          const status = effectiveHostStatus({
            status: statuses.get(id) ?? "connecting",
            since: host?.since ?? null,
            lastError: host?.failed ? "failed" : null,
            now,
          });
          return [id, status];
        }),
      ),
    [serverIds, statuses, waiting, now],
  );
}

interface WaitingStripHost extends WaitingHost {
  failed: boolean;
}

/**
 * Each connecting or idle Host's status start and whether it has an error, compared by value: a
 * failed attempt can leave a Host connecting, and the strip calls that "Can't connect".
 */
function useWaitingKey(serverIds: readonly string[]): string {
  const store = getHostRuntimeStore();
  const read = () =>
    serverIds
      .flatMap((id) => {
        const snapshot = store.getSnapshot(id);
        const status = snapshot?.connectionStatus ?? "connecting";
        if (status !== "connecting" && status !== "idle") return [];
        const since = getHostRuntimeConnectionStatusSince(id) ?? "";
        return [`${id}\t${since}\t${snapshot?.lastError ? 1 : 0}`];
      })
      .join("\n");
  return useSyncExternalStore((onChange) => store.subscribeAll(onChange), read, read);
}

function parseWaitingKey(key: string): ReadonlyMap<string, WaitingStripHost> {
  if (!key) return new Map();
  return new Map(
    key.split("\n").map((line) => {
      const [id = "", since = "", failed] = line.split("\t");
      return [id, { since: since ? Number(since) : null, failed: failed === "1" }];
    }),
  );
}

/** Every Host and Hub this device knows, reduced to what the Home strip shows. */
export function useHostsStrip() {
  const hosts = useAvailableHosts();
  const localServerId = useLocalDaemonServerId();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const statuses = useEffectiveStatuses(serverIds);
  // Home already loads the directory; the strip only asks which Hosts have sessions, so an agent
  // update re-renders it only when that set changes.
  const withSessionsKey = useSessionStore((state) => hostsWithSessionsKey(state.sessions));
  const accounts = useHubAccounts();
  const { profiles } = useHubProfiles();
  return useMemo(() => {
    const personal = new Set(
      accounts
        .filter((account) => account.connection?.accountAuthentication === "personal")
        .map((account) => account.origin),
    );
    const withSessions = parseHostsWithSessionsKey(withSessionsKey);
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
        hasSessions: withSessions.has(host.serverId),
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
      hubs: hubs
        .filter((hub) => !hub.personal)
        .sort((a, b) => a.name.localeCompare(b.name) || a.origin.localeCompare(b.origin)),
      issues: connectionIssues(stripHosts, hubs),
      summary: onlineSummary(stripHosts),
    };
  }, [hosts, localServerId, statuses, withSessionsKey, accounts, profiles]);
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
