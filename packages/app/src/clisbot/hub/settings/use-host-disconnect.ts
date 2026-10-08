import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useHubAccount } from "../account-provider";
import { hubResourceQueryKey } from "../query-keys";

/**
 * Disconnect a Host from the Hub, after a confirmation. A confirmation answered
 * after leaving the page does nothing; a successful disconnect is never replayed.
 */
export function useHostDisconnect(daemonId: string, name: string) {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const mutation = useMutation({
    mutationFn: async () => {
      const confirmed = await confirmDialog({
        title: t("hub.settings.hostDisconnect.title"),
        message: t("hub.settings.hostDisconnect.message", { name }),
        confirmLabel: t("hub.settings.hostDisconnect.confirm"),
        destructive: true,
      });
      if (!confirmed || !mounted.current) return false;
      await hub.api().delete(`daemons/${encodeURIComponent(daemonId)}`);
      return true;
    },
    onSuccess: (disconnected) =>
      disconnected
        ? queryClient.invalidateQueries({
            queryKey: hubResourceQueryKey(
              {
                origin: hub.origin,
                organizationId: hub.signedIn?.organization.id ?? null,
                accountId: hub.signedIn?.account.id ?? null,
              },
              "daemons",
            ),
          })
        : undefined,
  });
  const done = mutation.isSuccess && mutation.data;
  const disconnect = useCallback(() => {
    if (!mutation.isPending && !done) mutation.mutate();
  }, [done, mutation]);
  return { disconnect, pending: mutation.isPending, done, error: mutation.error };
}
