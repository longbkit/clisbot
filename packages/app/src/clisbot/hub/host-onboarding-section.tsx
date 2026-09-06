import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { useFetchQuery } from "@/data/query";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useHostRuntimeConnectionStatuses, useHosts } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { buildHostRootRoute, buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { useHubAccount } from "./account-provider";
import { HubDaemonsSchema } from "./contracts";
import { hubResourceQueryKey } from "./query-keys";
import { ManagedHostRename } from "./settings/managed-host-rename";
import {
  hubHostSynchronizationKey,
  useHubHostSynchronizationFailure,
} from "./host-synchronization-status";
import {
  buildHubLoginCommand,
  hubHostConnectionOfferHint,
  projectHubHostOnboarding,
  type HubHostOnboardingItem,
  type HubHostOnboardingStatus,
} from "./host-onboarding";

type CopyCommandState =
  | { status: "idle" | "copying" | "copied" }
  | { status: "error"; message: string };

export function HubHostOnboardingSection() {
  const hub = useHubAccount();
  const hosts = useHosts();
  const openAddProject = useOpenAddProject();
  const [copyState, setCopyState] = useState<CopyCommandState>({ status: "idle" });
  const organizationId = hub.signedIn?.organization.id ?? null;
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const daemons = useFetchQuery({
    queryKey: hubResourceQueryKey(
      { origin: hub.origin, organizationId, accountId: hub.signedIn?.account.id ?? null },
      "daemons",
    ),
    queryFn: () => hub.api().get("daemons", HubDaemonsSchema),
    dataShape: "value",
    enabled: organizationId !== null,
    retry: false,
    refetchInterval: 60_000,
    staleTimeMs: 0,
  });
  const items = useMemo(
    () =>
      projectHubHostOnboarding({
        daemons: daemons.data?.daemons ?? [],
        hosts,
        connectionStatuses,
      }),
    [connectionStatuses, daemons.data?.daemons, hosts],
  );
  const command = buildHubLoginCommand(hub.origin ?? "");
  const copyCommand = useCallback(() => {
    setCopyState({ status: "copying" });
    void copyToClipboard(command)
      .then(() => setCopyState({ status: "copied" }))
      .catch((error: unknown) => {
        setCopyState({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to copy command.",
        });
      });
  }, [command]);
  const retry = useCallback(() => void daemons.refetch(), [daemons]);
  const refreshAction = useMemo(
    () => (
      <Button size="sm" variant="ghost" loading={daemons.isFetching} onPress={retry}>
        Refresh Hosts
      </Button>
    ),
    [daemons.isFetching, retry],
  );

  if (!hub.enabled || hub.signedIn === null || hub.origin === null) return null;

  let content: ReactNode = null;
  if (daemons.isPending) {
    content = <Text style={settingsStyles.rowHint}>Loading Hosts...</Text>;
  } else if (
    daemons.data !== undefined &&
    items.length === 0 &&
    !hub.signedIn.capabilities.manageResources
  ) {
    content = (
      <Alert
        variant="info"
        title="No Hosts available"
        description="Ask an organization owner or admin to give you access to a Host and Project."
      />
    );
  } else if (daemons.data !== undefined && items.length === 0) {
    content = (
      <>
        <Alert
          variant="info"
          title="No Hosts yet"
          description="Run this command on the computer you want to use as a Host."
        />
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text selectable style={styles.command}>
                {command}
              </Text>
              {copyState.status === "error" ? (
                <Text style={settingsStyles.rowError}>{copyState.message}</Text>
              ) : null}
            </View>
            <Button
              size="sm"
              variant="outline"
              loading={copyState.status === "copying"}
              onPress={copyCommand}
            >
              {copyState.status === "copied" ? "Copied" : "Copy command"}
            </Button>
          </View>
        </View>
      </>
    );
  } else if (items.length > 0) {
    content = (
      <View style={settingsStyles.card}>
        {items.map((item, index) => (
          <HubHostOnboardingRow
            key={item.daemonId}
            item={item}
            bordered={index > 0}
            openAddProject={openAddProject}
          />
        ))}
      </View>
    );
  }
  return (
    <SettingsSection title="Hosts" trailing={refreshAction}>
      {daemons.error ? (
        <Alert
          variant="error"
          title="Hosts unavailable"
          description="Paseo could not refresh your Hosts. Check your connection and use Refresh Hosts to try again."
        />
      ) : null}
      {content}
    </SettingsSection>
  );
}

function HubHostOnboardingRow({
  item,
  bordered,
  openAddProject,
}: {
  item: HubHostOnboardingItem;
  bordered: boolean;
  openAddProject(preferredHostId?: string): void;
}) {
  const router = useRouter();
  const hub = useHubAccount();
  const failure = useHubHostSynchronizationFailure(
    hubHostSynchronizationKey({
      origin: hub.origin,
      organizationId: hub.signedIn?.organization.id ?? null,
      accountId: hub.signedIn?.account.id ?? null,
      daemonId: item.daemonId,
    }),
  );
  const addProject = useCallback(() => {
    if (item.serverId === null) return;
    if (item.canManage) openAddProject(item.serverId);
    else router.push(buildHostRootRoute(item.serverId));
  }, [item.serverId, item.canManage, openAddProject, router]);
  const openConnections = useCallback(() => {
    if (item.serverId !== null)
      router.push(buildSettingsHostSectionRoute(item.serverId, "connections"));
  }, [item.serverId, router]);
  const status = hostStatusPresentation(failure === null ? item.status : "error");
  const description =
    item.serverId === null
      ? hubHostConnectionOfferHint(item.status === "waiting" ? "connected" : item.status)
      : status.description;
  return (
    <View style={[settingsStyles.row, bordered ? settingsStyles.rowBorder : null]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{item.label}</Text>
        <Text style={failure === null ? settingsStyles.rowHint : settingsStyles.rowError}>
          {failure?.message ?? description}
        </Text>
      </View>
      <View style={styles.trailing}>
        <StatusBadge label={status.label} variant={status.variant} />
        <ManagedHostRename daemonId={item.daemonId} name={item.daemonSlug} />
        {failure ? (
          <Button size="sm" variant="outline" onPress={failure.retry}>
            Retry
          </Button>
        ) : null}
        {failure === null && item.status === "online" ? (
          <Button size="sm" variant="outline" onPress={addProject}>
            {item.canManage ? "Add project" : "Open Host"}
          </Button>
        ) : null}
        {item.serverId !== null &&
        item.status !== "registering" &&
        (failure !== null || item.status !== "online") ? (
          <Button size="sm" variant="outline" onPress={openConnections}>
            Connections
          </Button>
        ) : null}
      </View>
    </View>
  );
}

function hostStatusPresentation(status: HubHostOnboardingStatus): {
  label: string;
  description: string;
  variant: StatusBadgeVariant;
} {
  if (status === "online") {
    return { label: "Online", description: "Ready for Projects and Agents", variant: "success" };
  }
  if (status === "connecting") {
    return {
      label: "Connecting",
      description: "Paseo is connecting to this Host",
      variant: "muted",
    };
  }
  if (status === "waiting") {
    return {
      label: "Waiting for connection",
      description: hubHostConnectionOfferHint("connected"),
      variant: "muted",
    };
  }
  if (status === "unavailable") {
    return {
      label: "Status unavailable",
      description: hubHostConnectionOfferHint("unavailable"),
      variant: "muted",
    };
  }
  if (status === "offline" || status === "error") {
    return {
      label: status === "offline" ? "Offline" : "Connection failed",
      description: "Check that Paseo is running on this Host, then review its connections.",
      variant: status === "offline" ? "muted" : "error",
    };
  }
  return {
    label: "Registering",
    description: "Paseo is adding this Daemon as a Host",
    variant: "muted",
  };
}

const styles = StyleSheet.create((theme) => ({
  command: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  trailing: {
    alignItems: "flex-end",
    gap: theme.spacing[2],
  },
}));
