import { chatTranscriptQueryBaseKey } from "@/clisbot/bots/data/query-keys";
import { useTranscriptStore } from "@/clisbot/bots/data/transcript-store";
import { queryClient } from "@/data/query-client";
import type { ReplicaCache } from "@/runtime/replica-cache";
import { clearDownloadedFiles, downloadedFilesBytes } from "@/stores/downloaded-files";

/**
 * What this device holds for offline use: replica rows (sessions, tails, chats) and downloaded
 * files. Clearing never deletes anything on a Host (docs/features/offline/offline-cache.md).
 */
export async function offlineDataBytes(cache: ReplicaCache): Promise<number> {
  return (await cache.usedBytes()) + downloadedFilesBytes();
}

/**
 * Forgets what the given sources left on this device: their rows and their chats in memory.
 * An open chat of such a source reloads from its Host.
 */
export async function clearOfflineSources(
  cache: ReplicaCache,
  serverIds: readonly string[],
): Promise<void> {
  for (const serverId of serverIds) {
    useTranscriptStore.getState().clearSource(serverId);
    await queryClient.resetQueries({ queryKey: [...chatTranscriptQueryBaseKey, serverId] });
    await cache.clearSource(serverId);
  }
}

/** Settings → Storage → Clear offline cache. Rejects when the store or the files cannot clear. */
export async function clearOfflineData(cache: ReplicaCache): Promise<void> {
  useTranscriptStore.getState().clearAll();
  await queryClient.resetQueries({ queryKey: chatTranscriptQueryBaseKey });
  await cache.clearAll();
  clearDownloadedFiles();
}
