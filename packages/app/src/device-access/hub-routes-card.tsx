import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { HostTailscale } from "@clisbot/protocol/host-tailscale";
import { StatusBadge } from "@/components/ui/status-badge";
import { useFetchQuery } from "@/data/query";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHostRuntimeConnectedServerIds, useHosts } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { tailscaleRowModel, useHostTailscale, type TailscaleRowModel } from "./host-tailscale";
import type { HubProfile } from "./hub-profiles";
import { canStartHubOnHost, findHubHost, isTailscaleOrigin, setUpHubTailscale } from "./hub-routes";
import { TailscaleRouteRow } from "./tailscale-route-row";

/** "Ways to connect" for a Hub. Tailscale shows only when this device can set it up through
 * the Host running the Hub, or the Hub already uses it; a team Hub's address is its operator's. */
export function HubRoutesCard({ profile, onUpdated }: { profile: HubProfile; onUpdated?(): void }) {
  const { t } = useTranslation();
  const tailscale = useHubTailscale(profile, onUpdated);
  return (
    <View style={settingsStyles.card}>
      {tailscale.visible ? (
        <TailscaleRouteRow
          model={tailscale.model}
          description={t("pairing.tailscale.description")}
          actionUrl={tailscale.actionUrl}
          error={tailscale.error}
          onSetUp={tailscale.setUp}
          onRetry={tailscale.retry}
        />
      ) : null}
      <View style={[settingsStyles.row, tailscale.visible && settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("pairing.routes.relayTitle")}</Text>
          <Text style={settingsStyles.rowHint}>{t("pairing.routes.relayDescription")}</Text>
        </View>
        <StatusBadge
          label={profile.relay ? t("pairing.routes.on") : t("pairing.routes.off")}
          variant={profile.relay ? "success" : "muted"}
        />
      </View>
    </View>
  );
}

function useHubTailscale(profile: HubProfile, onUpdated?: () => void) {
  const host = useHubHost(profile.hubId);
  const localServerId = useLocalDaemonServerId();
  const hostTailscale = useHostTailscale(host.serverId);
  const mapped = isTailscaleOrigin(profile.origin);
  const canStart = host.serverId ? canStartHubOnHost(host.serverId, localServerId) : false;
  const setUp = useMutation({
    mutationFn: () => {
      if (!host.serverId) throw new Error("Connect the Host that runs this Hub first");
      return setUpHubTailscale({ profile, serverId: host.serverId, localServerId });
    },
    onSuccess: (result) => {
      if (result.state === "ready") onUpdated?.();
    },
  });
  const observed = setUp.data ?? hostTailscale.query.data;
  const { mutate, reset } = setUp;
  const { refetch: refetchStatus } = hostTailscale.query;
  const { refetch: refetchHost } = host;
  const retry = useCallback(() => {
    reset();
    void refetchStatus();
    void refetchHost();
  }, [reset, refetchStatus, refetchHost]);
  const start = useCallback(() => mutate(), [mutate]);
  return {
    visible: mapped || canStart,
    model: hubTailscaleModel({
      mapped,
      origin: profile.origin,
      observed,
      statusReadable: hostTailscale.supported,
      statusFailed: hostTailscale.query.isError,
      settingUp: setUp.isPending,
    }),
    actionUrl: observed?.actionUrl,
    error: setUp.error?.message ?? null,
    setUp: start,
    retry,
  };
}

function hubTailscaleModel(input: {
  mapped: boolean;
  origin: string | undefined;
  observed: HostTailscale | undefined;
  statusReadable: boolean;
  statusFailed: boolean;
  settingUp: boolean;
}): TailscaleRowModel {
  if (input.mapped)
    return tailscaleRowModel({ tailscale: { state: "ready", origin: input.origin }, mapped: true });
  // A Host older than the status RPC can still re-run its Hub over Tailscale; the result
  // reports what happened.
  if (!input.observed && !input.statusReadable && !input.settingUp)
    return { status: "notSetUp", tone: "muted", actions: ["setUp"] };
  return tailscaleRowModel({
    tailscale: input.observed,
    settingUp: input.settingUp,
    failed: input.statusFailed,
  });
}

function useHubHost(hubId: string) {
  const hosts = useHosts();
  const ids = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const connected = useHostRuntimeConnectedServerIds(ids);
  const query = useFetchQuery({
    queryKey: ["hub-host", hubId, connected.join(",")],
    queryFn: () => findHubHost(hubId, connected),
    dataShape: "value",
    staleTimeMs: 30_000,
  });
  return {
    serverId: query.data ?? undefined,
    refetch: query.refetch,
  };
}
