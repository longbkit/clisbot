import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-api-context";
import { useHostMutations } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";

/**
 * Forget a saved Host on this device after confirming, with the Host page's wording. Not for
 * the desktop's own daemon: removing that also stops it, which only its Host page does.
 */
export function useConfirmRemoveHost(serverId: string, label: string) {
  const { t } = useTranslation();
  const toast = useToast();
  const { removeHost } = useHostMutations();
  const [removing, setRemoving] = useState(false);
  const remove = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("settings.host.daemon.remove.title"),
      message: t("settings.host.daemon.remove.confirmMessage", { name: label }),
      confirmLabel: t("settings.host.daemon.remove.title"),
      destructive: true,
    });
    if (!confirmed) return;
    setRemoving(true);
    try {
      await removeHost(serverId);
    } catch {
      toast.error(t("settings.host.daemon.remove.errorMessage"));
    } finally {
      setRemoving(false);
    }
  }, [label, removeHost, serverId, t, toast]);
  return { remove, removing };
}
