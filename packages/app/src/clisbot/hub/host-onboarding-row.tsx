import { useCallback, useMemo } from "react";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { buildHostRootRoute, buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { useHubAccount } from "./account-provider";
import { CopyableCommand } from "./copyable-command";
import {
  hubHostOfferHint,
  hubHostStatusPresentation,
  type HubHostOnboardingItem,
} from "./host-onboarding";
import {
  hubHostSynchronizationKey,
  useHubHostSynchronizationFailure,
} from "./host-synchronization-status";
import { ManagedHostRename } from "./settings/managed-host-rename";
import { RowActionsMenu } from "./settings/team/row-actions-menu";
import { useHostDisconnect } from "./settings/use-host-disconnect";

interface SynchronizationFailure {
  message: string;
  retry: () => void;
}

/**
 * One Hub Host: name and status on the first line, what to do next under it, then actions in a
 * single row. A Host Paseo cannot reach also shows the command that checks its daemon.
 */
export function HubHostOnboardingRow({
  item,
  bordered,
  cliCommand,
  openAddProject,
}: {
  item: HubHostOnboardingItem;
  bordered: boolean;
  cliCommand: string;
  openAddProject(preferredHostId?: string): void;
}) {
  const hub = useHubAccount();
  const failure = useHubHostSynchronizationFailure(
    hubHostSynchronizationKey({
      origin: hub.origin,
      organizationId: hub.signedIn?.organization.id ?? null,
      accountId: hub.signedIn?.account.id ?? null,
      daemonId: item.daemonId,
    }),
  );
  const disconnect = useHostDisconnect(item.daemonId, item.daemonSlug);
  const status = hubHostStatusPresentation(failure === null ? item.status : "error");
  const unreachable =
    failure === null &&
    item.serverId !== null &&
    (item.status === "offline" || item.status === "error");
  const description = item.serverId === null ? hubHostOfferHint(item.status) : status.description;
  return (
    <View style={[settingsStyles.row, styles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={styles.heading}>
        <Text style={[settingsStyles.rowTitle, styles.title]} numberOfLines={1}>
          {item.label}
        </Text>
        <StatusBadge label={status.label} variant={status.variant} />
      </View>
      <Text style={failure === null ? settingsStyles.rowHint : settingsStyles.rowError}>
        {failure?.message ?? description}
      </Text>
      {disconnect.error ? (
        <Text style={settingsStyles.rowError}>{disconnect.error.message}</Text>
      ) : null}
      {unreachable ? (
        <CopyableCommand command={`${cliCommand} daemon status`} copyLabel="Copy" />
      ) : null}
      <View style={styles.actions}>
        <HostPrimaryAction item={item} failure={failure} openAddProject={openAddProject} />
        <HostConnectionsAction item={item} failure={failure} />
        <ManagedHostRename daemonId={item.daemonId} name={item.daemonSlug} />
        {item.canManage && hub.signedIn?.capabilities.manageResources ? (
          <HostDisconnectMenu item={item} host={disconnect} />
        ) : null}
      </View>
    </View>
  );
}

/** Disconnect sits behind the menu, away from the everyday actions beside it. */
function HostDisconnectMenu({
  item,
  host,
}: {
  item: HubHostOnboardingItem;
  host: ReturnType<typeof useHostDisconnect>;
}) {
  const actions = useMemo(
    () => [
      {
        label: host.done ? "Disconnected" : "Disconnect",
        destructive: true,
        disabled: host.pending || host.done,
        onSelect: host.disconnect,
      },
    ],
    [host.disconnect, host.done, host.pending],
  );
  return <RowActionsMenu label={`Actions for ${item.label}`} actions={actions} disabled={false} />;
}

/** Retry a failed synchronization, reconnect an unreachable Host, or open an online one. */
function HostPrimaryAction({
  item,
  failure,
  openAddProject,
}: {
  item: HubHostOnboardingItem;
  failure: SynchronizationFailure | null;
  openAddProject(preferredHostId?: string): void;
}) {
  const router = useRouter();
  const { serverId, canManage, status } = item;
  const reconnect = useCallback(() => {
    if (serverId !== null) void getHostRuntimeStore().restartHostConnection(serverId);
  }, [serverId]);
  const open = useCallback(() => {
    if (serverId === null) return;
    if (canManage) openAddProject(serverId);
    else router.push(buildHostRootRoute(serverId));
  }, [serverId, canManage, openAddProject, router]);
  if (failure !== null) {
    return (
      <Button size="sm" variant="outline" onPress={failure.retry}>
        Retry
      </Button>
    );
  }
  if (serverId === null) return null;
  if (status === "online") {
    return (
      <Button size="sm" variant="outline" onPress={open}>
        {canManage ? "Add project" : "Open Host"}
      </Button>
    );
  }
  if (status !== "offline" && status !== "error") return null;
  return (
    <Button size="sm" variant="outline" onPress={reconnect}>
      Reconnect
    </Button>
  );
}

function HostConnectionsAction({
  item,
  failure,
}: {
  item: HubHostOnboardingItem;
  failure: SynchronizationFailure | null;
}) {
  const router = useRouter();
  const { serverId } = item;
  const openConnections = useCallback(() => {
    if (serverId !== null) router.push(buildSettingsHostSectionRoute(serverId, "connections"));
  }, [serverId, router]);
  const hidden =
    serverId === null ||
    item.status === "registering" ||
    (failure === null && item.status === "online");
  if (hidden) return null;
  return (
    <Button size="sm" variant="ghost" onPress={openConnections}>
      Connections
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing[2],
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
