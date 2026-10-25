import { useCallback, useMemo, useSyncExternalStore } from "react";
import { type HubSourceHealth, useHubSourceHealth } from "@/clisbot/hub/hub-source-health";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  getSourceHealthStore,
  type SourceHealth,
  type SourceHealthStore,
  type SourceState,
} from "@/runtime/source-health";

/** Why a source is not live, so the UI can name the next step. */
export type SourceProblem =
  | "host-unreachable"
  | "hub-unreachable"
  | "host-sign-in"
  | "hub-sign-in"
  | "hub-revoked";

export interface SourceStatus extends SourceHealth {
  /** The Host's own state, overridden by its Hub when the Hub asks to sign in or revoked access. */
  effectiveState: SourceState;
  problem: SourceProblem | null;
}

export interface HubSourceSummary extends HubSourceHealth {
  reachable: number;
  total: number;
}

export interface SourceHealthSummary {
  total: number;
  /** Live or syncing: usable now. */
  reachable: number;
  live: number;
  syncing: number;
  offline: number;
  needsSignIn: number;
  revoked: number;
  /** Sources that are not reachable, by label. */
  degraded: SourceStatus[];
  /** Per Hub, e.g. "92/100 reachable"; Hubs with no Host on this device still appear. */
  hubs: HubSourceSummary[];
}

function useStore(): SourceHealthStore {
  return getSourceHealthStore(getHostRuntimeStore());
}

/** Combines a Host's own health with the Hub that manages it. */
export function resolveSourceStatus(
  health: SourceHealth,
  hub: HubSourceHealth | undefined,
): SourceStatus {
  const reachable = health.state === "live" || health.state === "syncing";
  if (!reachable && hub?.state === "revoked")
    return { ...health, effectiveState: "revoked", problem: "hub-revoked" };
  if (!reachable && hub?.state === "needs-sign-in")
    return { ...health, effectiveState: "needs-sign-in", problem: "hub-sign-in" };
  let problem: SourceProblem | null = null;
  if (health.state === "needs-sign-in") problem = "host-sign-in";
  else if (health.state === "revoked") problem = "hub-revoked";
  else if (health.state === "offline")
    problem = hub?.state === "unreachable" ? "hub-unreachable" : "host-unreachable";
  return { ...health, effectiveState: health.state, problem };
}

export function summarizeSourceHealth(
  entries: readonly SourceHealth[],
  hubs: readonly HubSourceHealth[],
): SourceHealthSummary {
  const hubByOrigin = new Map(hubs.map((hub) => [hub.origin, hub]));
  const counts = { live: 0, syncing: 0, offline: 0, needsSignIn: 0, revoked: 0 };
  const perHub = new Map<string, { reachable: number; total: number }>();
  const degraded: SourceStatus[] = [];
  for (const entry of entries) {
    const hub = entry.hubOrigin === null ? undefined : hubByOrigin.get(entry.hubOrigin);
    const status = resolveSourceStatus(entry, hub);
    const reachable = status.effectiveState === "live" || status.effectiveState === "syncing";
    if (status.effectiveState === "live") counts.live += 1;
    else if (status.effectiveState === "syncing") counts.syncing += 1;
    else if (status.effectiveState === "offline") counts.offline += 1;
    else if (status.effectiveState === "needs-sign-in") counts.needsSignIn += 1;
    else counts.revoked += 1;
    if (!reachable) degraded.push(status);
    if (entry.hubOrigin !== null) {
      const tally = perHub.get(entry.hubOrigin) ?? { reachable: 0, total: 0 };
      tally.total += 1;
      if (reachable) tally.reachable += 1;
      perHub.set(entry.hubOrigin, tally);
    }
  }
  degraded.sort((left, right) => left.label.localeCompare(right.label));
  return {
    total: entries.length,
    reachable: counts.live + counts.syncing,
    ...counts,
    degraded,
    hubs: hubs.map((hub) => ({
      ...hub,
      ...(perHub.get(hub.origin) ?? { reachable: 0, total: 0 }),
    })),
  };
}

/** Plain-language status for one source; Hub outages suggest a VPN without claiming it is off. */
export function describeSourceProblem(status: SourceStatus, hubLabel?: string): string {
  const hub = hubLabel ?? "The Hub";
  switch (status.problem) {
    case "hub-unreachable":
      return `${status.label}: ${hub} is unreachable. If it is reached over a VPN, check that connection.`;
    case "hub-sign-in":
      return `${status.label}: sign in to ${hub} again.`;
    case "hub-revoked":
      return `${status.label}: access was removed.`;
    case "host-sign-in":
      return `${status.label}: enter the Host password again.`;
    case "host-unreachable":
      return `${status.label}: ${status.error ?? "Disconnected. Reconnect to refresh conversations."}`;
    default:
      return status.label;
  }
}

/** One source's health; re-renders only when that source's shown health changes. */
export function useSourceHealth(serverId: string): SourceStatus | null {
  const store = useStore();
  const hubs = useHubSourceHealth();
  const subscribe = useCallback(
    (notify: () => void) => store.subscribeSource(serverId, notify),
    [serverId, store],
  );
  const read = useCallback(() => store.get(serverId), [serverId, store]);
  const health = useSyncExternalStore(subscribe, read, read);
  return useMemo(() => {
    if (!health) return null;
    const hub =
      health.hubOrigin === null ? undefined : hubs.find((h) => h.origin === health.hubOrigin);
    return resolveSourceStatus(health, hub);
  }, [health, hubs]);
}

/** Selected sources' health; `serverIds` omitted means every registered Host. */
export function useSourceHealthEntries(serverIds?: readonly string[]): readonly SourceHealth[] {
  const store = useStore();
  const all = useSyncExternalStore(store.subscribe, store.getEntries, store.getEntries);
  const key = serverIds?.join("\u0000");
  return useMemo(() => {
    if (key === undefined) return all;
    const ids = new Set(key.length ? key.split("\u0000") : []);
    return all.filter((entry) => ids.has(entry.serverId));
  }, [all, key]);
}

/** Counts and the degraded list across sources, plus per-Hub reachability. */
export function useSourceHealthSummary(serverIds?: readonly string[]): SourceHealthSummary {
  const entries = useSourceHealthEntries(serverIds);
  const hubs = useHubSourceHealth();
  return useMemo(() => summarizeSourceHealth(entries, hubs), [entries, hubs]);
}
