import {
  getHubDaemonListCache,
  type CachedHubDaemonList,
} from "@/clisbot/hub/hub-daemon-list-cache";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { OFFLINE_CACHE_ENABLED } from "@/runtime/replica-cache/offline-flag";
import { clearOfflineSources } from "./clear";

/** The Hosts a remembered Hub daemon list reaches. */
export function hubServerIds(list: CachedHubDaemonList | undefined): string[] {
  return (list?.daemons ?? []).flatMap((daemon) =>
    daemon.connectionOffer ? [daemon.connectionOffer.serverId] : [],
  );
}

/**
 * Forgets what this Hub's Hosts left on the device. Call before the remembered list is
 * forgotten (sign-out, removing the Hub profile): that list is how the Hosts are found.
 */
export async function clearHubOfflineData(origin: string): Promise<void> {
  if (!OFFLINE_CACHE_ENABLED) return;
  const serverIds = hubServerIds(getHubDaemonListCache().get(origin));
  await clearOfflineSources(getHostRuntimeStore().getReplicaCache(), serverIds);
}
