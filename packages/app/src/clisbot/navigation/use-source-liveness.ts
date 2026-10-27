import { useMemo } from "react";
import { useHostInventory } from "@/clisbot/hub/host-inventory";
import { useHubDaemonListsLoaded } from "@/clisbot/hub/hub-daemon-list-cache";
import { useHubSourceHealth } from "@/clisbot/hub/hub-source-health";
import {
  resolveSourceStatus,
  useSourceHealth,
  useSourceHealthEntries,
} from "@/hooks/use-source-health";
import { useHostRegistryLoaded, useHosts } from "@/runtime/host-runtime";
import { NAVIGATION_V2_ENABLED } from "./feature";
import { cachedServerIds, isCachedSource, listableServerIds } from "./source-liveness";

const NO_IDS: ReadonlySet<string> = new Set();

/** A stable set while its members do not change, so memoized readers do not re-derive. */
function useStableSet(ids: ReadonlySet<string>): ReadonlySet<string> {
  const key = [...ids].sort().join("\n");
  return useMemo(() => (key ? new Set(key.split("\n")) : NO_IDS), [key]);
}

/**
 * Which Hosts' sessions Navigation V2 lists, and which of those are cached rather than live
 * (source-liveness.ts). Home and the Workspace list both read this one answer.
 */
export function useSourceLiveness(): {
  listable: ReadonlySet<string>;
  cached: ReadonlySet<string>;
} {
  const registered = useHosts();
  const registryLoaded = useHostRegistryLoaded();
  const { hosts: inventory, settled } = useHostInventory();
  const daemonListsLoaded = useHubDaemonListsLoaded();
  const entries = useSourceHealthEntries();
  const hubs = useHubSourceHealth();
  const judged = registryLoaded && settled && daemonListsLoaded;
  const listable = useStableSet(
    useMemo(
      () =>
        listableServerIds({
          registered: registered.map((host) => host.serverId),
          inventory: inventory.map((host) => host.serverId),
          settled: judged,
        }),
      [registered, inventory, judged],
    ),
  );
  const cached = useStableSet(
    useMemo(
      () =>
        cachedServerIds({
          statuses: entries.map((entry) =>
            resolveSourceStatus(
              entry,
              hubs.find((hub) => hub.origin === entry.hubOrigin),
            ),
          ),
          listable,
        }),
      [entries, hubs, listable],
    ),
  );
  return { listable, cached };
}

// Outside Navigation V2 nothing is cached: the Home V2 sidebar keeps reading raw status.
const useV2Cached = (): ReadonlySet<string> => useSourceLiveness().cached;
const useNoCached = (): ReadonlySet<string> => NO_IDS;

/** The cached Hosts, for session lines; empty when Navigation V2 is off. */
export const useCachedServerIds = NAVIGATION_V2_ENABLED ? useV2Cached : useNoCached;

const useV2SourceCached = (serverId: string): boolean => isCachedSource(useSourceHealth(serverId));
const useNoSourceCached = (): boolean => false;

/** One Host's cachedness, for a row that cannot afford the whole fleet's liveness. */
export const useIsSourceCached = NAVIGATION_V2_ENABLED ? useV2SourceCached : useNoSourceCached;
