// Settings → Hosts: the machines in the organization that run Agents. Everyone
// signed in sees the Hosts they may use and can open or reconnect them; an
// Organization Admin also renames, disconnects, and adds Hosts. Who may use each
// Host is set in People & access › Access.

import { useRouter } from "expo-router";
import { useCallback, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useHostRuntimeConnectionStatuses, useHosts } from "@/runtime/host-runtime";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { HubDaemonsSchema } from "../contracts";
import { CopyableCommand } from "../copyable-command";
import { buildHubLoginCommand, projectHubHostOnboarding } from "../host-onboarding";
import { HubHostOnboardingRow } from "../host-onboarding-row";
import { hubResourceQueryKey } from "../query-keys";

/** Set only by `npm run dev:clisbot`: this checkout's CLI against the dev home. An `EXPO_PUBLIC_`
 * variable rather than an Expo config extra, because Metro caches the inlined app manifest. */
const DEV_CLI_COMMAND = process.env.EXPO_PUBLIC_CLISBOT_DEV_CLI_COMMAND?.trim() || undefined;

const INFO =
  "Machines in your organization that run Agents. Who may use each one is set in People & access › Access.";

export function HostsSettings() {
  const hub = useHubAccount();
  const hosts = useHosts();
  const openAddProject = useOpenAddProject();
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
  const command = buildHubLoginCommand(hub.origin ?? "", DEV_CLI_COMMAND);
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
      <Alert
        variant="info"
        title="No Hosts yet"
        description="Add one with the command under Add a Host."
      />
    );
  } else if (items.length > 0) {
    content = (
      <View style={settingsStyles.card}>
        {items.map((item, index) => (
          <HubHostOnboardingRow
            key={item.daemonId}
            item={item}
            bordered={index > 0}
            cliCommand={DEV_CLI_COMMAND ?? "paseo"}
            openAddProject={openAddProject}
          />
        ))}
      </View>
    );
  }
  const canManage = hub.signedIn.capabilities.manageResources;
  return (
    <View>
      <SettingsSection title="Hosts" info={INFO} trailing={refreshAction}>
        {daemons.error ? (
          <Alert
            variant="error"
            title="Hosts unavailable"
            description="Paseo could not refresh your Hosts. Check your connection and use Refresh Hosts to try again."
          />
        ) : null}
        {content}
      </SettingsSection>
      {canManage && daemons.data !== undefined ? <AddHostSection command={command} /> : null}
    </View>
  );
}

/** How to add a Host, always at hand for an Organization Admin, and where its access is set. */
function AddHostSection({ command }: { command: string }) {
  const router = useRouter();
  const openAccess = useCallback(
    () =>
      router.push({
        pathname: "/settings/hub/[hubSection]",
        params: { hubSection: "team", view: "access" },
      }),
    [router],
  );
  const accessLink = useMemo(
    () => (
      <Button size="sm" variant="ghost" onPress={openAccess}>
        Manage access
      </Button>
    ),
    [openAccess],
  );
  return (
    <SettingsSection
      title="Add a Host"
      info="Run this on the computer you want to add. It joins this organization; then choose who may use it in People & access › Access."
      trailing={accessLink}
    >
      <CopyableCommand command={command} />
    </SettingsSection>
  );
}
