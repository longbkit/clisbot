import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { offlineT } from "@/i18n/offline";
import { formatFileSize } from "@/utils/format-file-size";
import { useOfflineStorage } from "./use-offline-storage";

/** Settings → Storage: what this device keeps for offline use, and clearing it. */
export function StorageSection() {
  const { usedBytes, clearState, clear } = useOfflineStorage();
  const clearing = clearState.status === "clearing";
  const used =
    usedBytes === null ? null : offlineT("storage.used", { size: formatFileSize(usedBytes) });
  const status = clearState.status === "cleared" ? offlineT("storage.cleared") : used;
  // The second line is always there, so the row keeps its height while the size loads.
  const hint = `${offlineT("storage.offlineCacheHint")}\n${status ?? " "}`;
  return (
    <SettingsSection title={offlineT("storage.title")} testID="offline-storage-settings">
      <SettingsCard>
        <SettingsRow
          label={offlineT("storage.offlineCache")}
          hint={hint}
          error={clearState.status === "failed" ? offlineT("storage.clearFailed") : undefined}
          testID="offline-storage-row"
        >
          <Button variant="outline" size="sm" onPress={clear} disabled={clearing}>
            {clearing ? offlineT("storage.clearing") : offlineT("storage.clear")}
          </Button>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
