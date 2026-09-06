import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useHubAccount } from "../account-provider";
import type { HubDaemonsSchema } from "../contracts";
import { ManagedHostRename } from "./managed-host-rename";
import { hubResourceQueryKey } from "../query-keys";
import { hubHostConnectionOfferHint } from "../host-onboarding";

export function ManagedHostRow({
  daemon,
  bordered,
}: {
  daemon: z.infer<typeof HubDaemonsSchema>["daemons"][number];
  bordered: boolean;
}) {
  const hub = useHubAccount();
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const disconnect = useMutation({
    mutationFn: async () => {
      const confirmed = await confirmDialog({
        title: "Disconnect Host?",
        message: `Disconnect ${daemon.slug} from Hub and stop its Hub work? Enroll it again to reconnect.`,
        confirmLabel: "Disconnect",
        destructive: true,
      });
      if (!confirmed || !mounted.current) return false;
      await hub.api().delete(`daemons/${encodeURIComponent(daemon.id)}`);
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
  const confirmDisconnect = useCallback(() => {
    if (!disconnect.isPending) disconnect.mutate();
  }, [disconnect]);
  const disconnected = disconnect.isSuccess && disconnect.data;
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{daemon.slug}</Text>
        <Text style={settingsStyles.rowHint}>
          {`${daemon.presence} · ${daemon.canManage ? "Administrator" : "Assigned access"}`}
        </Text>
        {daemon.connectionOffer === null ? (
          <Text style={settingsStyles.rowHint}>{hubHostConnectionOfferHint(daemon.presence)}</Text>
        ) : null}
        {disconnect.error ? (
          <Text style={settingsStyles.rowError}>{disconnect.error.message}</Text>
        ) : null}
      </View>
      {hub.signedIn?.capabilities.manageResources ? (
        <View style={styles.actions}>
          <ManagedHostRename
            daemonId={daemon.id}
            name={daemon.slug}
            disabled={disconnect.isPending || disconnected}
          />
          {daemon.canManage ? (
            <Button
              size="sm"
              variant="outline"
              loading={disconnect.isPending}
              disabled={disconnected}
              onPress={confirmDisconnect}
            >
              {disconnected ? "Disconnected" : "Disconnect"}
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", gap: theme.spacing[2] },
}));
