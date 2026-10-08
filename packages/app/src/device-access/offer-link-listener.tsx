import { useEffect, useRef } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useToast } from "@/contexts/toast-context";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { pairedHubSettingsRoute } from "./pairing-target";

// Keep this listener outside the keyed Hub account scope: pairing a first Hub
// changes that scope before importConnectionLink returns its navigation target.
export function OfferLinkListener() {
  const router = useRouter();
  const toast = useToast();
  const current = useRef({ router, toast });
  current.current = { router, toast };

  useEffect(() => {
    let cancelled = false;
    const pending = new Set<string>();
    let failureToastId: number | undefined;
    const dismissFailure = () => {
      if (failureToastId !== undefined) current.current.toast.dismiss?.(failureToastId);
      failureToastId = undefined;
    };
    const handleUrl = async (url: string | null) => {
      if (
        !url ||
        (!url.includes("#offer=") && !url.includes("#connect=") && !url.startsWith("relay://")) ||
        pending.has(url)
      )
        return;
      pending.add(url);
      dismissFailure();
      try {
        const result = await getHostRuntimeStore().importConnectionLink(url, "openProject");
        if (cancelled) return;
        dismissFailure();
        if (result.status === "connected") current.current.router.replace(buildOpenProjectRoute());
        if (result.status === "hub_connected")
          current.current.router.replace(pairedHubSettingsRoute(url));
      } catch {
        if (!cancelled) {
          const id = current.current.toast.show(i18n.t("hub.connection.errors.pairingLinkFailed"), {
            variant: "error",
            durationMs: null,
            testID: "pairing-link-error",
          });
          failureToastId = typeof id === "number" ? id : undefined;
        }
      } finally {
        pending.delete(url);
      }
    };

    void Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => undefined);
    const subscription = Linking.addEventListener("url", (event) => void handleUrl(event.url));
    return () => {
      cancelled = true;
      pending.clear();
      subscription.remove();
    };
  }, []);

  return null;
}
