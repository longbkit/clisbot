import { useCallback, useState } from "react";
import { useFetchQuery } from "@/data/query";
import { offlineT } from "@/i18n/offline";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { clearOfflineData, offlineDataBytes } from "./clear";

export type ClearOfflineState =
  | { status: "idle" }
  | { status: "clearing" }
  | { status: "cleared" }
  | { status: "failed" };

const OFFLINE_STORAGE_QUERY_KEY = ["offline-storage", "used-bytes"] as const;

function replicaCache() {
  return getHostRuntimeStore().getReplicaCache();
}

/** Settings → Storage: the bytes kept for offline use and the confirmed Clear action. */
export function useOfflineStorage() {
  const used = useFetchQuery({
    queryKey: OFFLINE_STORAGE_QUERY_KEY,
    queryFn: () => offlineDataBytes(replicaCache()),
    dataShape: "value",
    staleTimeMs: 0,
  });
  const { refetch } = used;
  const [clearState, setClearState] = useState<ClearOfflineState>({ status: "idle" });
  const clear = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: offlineT("storage.confirmTitle"),
      message: offlineT("storage.confirmMessage"),
      confirmLabel: offlineT("storage.clear"),
      destructive: true,
    });
    if (!confirmed) return;
    setClearState({ status: "clearing" });
    try {
      await clearOfflineData(replicaCache());
      setClearState({ status: "cleared" });
    } catch {
      setClearState({ status: "failed" });
    }
    await refetch();
  }, [refetch]);
  return { usedBytes: used.data ?? null, clearState, clear };
}
