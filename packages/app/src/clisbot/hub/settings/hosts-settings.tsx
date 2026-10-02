// Settings → Host → Hosts: saved machines plus authorized organization Hosts.
// Everyone sees their saved Hosts and their connection states; an
// Organization Admin also renames, disconnects, and adds Hosts. Who may use each
// Host is set in People & access › Access.

import { useRouter } from "expo-router";
import { useCallback, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { SavedHostRow } from "./saved-host-row";
import { CopyableCommand } from "../copyable-command";
import { buildHubConnectCommand } from "../host-onboarding";
import { HubHostOnboardingRow } from "../host-onboarding-row";
import { useHostsSettingsInventory } from "./hosts-settings-inventory";
import { HostsConnectionCount } from "./hosts-settings-label";

/** Set only by `npm run dev:clisbot`: this checkout's CLI against the dev home. An `EXPO_PUBLIC_`
 * variable rather than an Expo config extra, because Metro caches the inlined app manifest. */
const DEV_CLI_COMMAND = process.env.EXPO_PUBLIC_CLISBOT_DEV_CLI_COMMAND?.trim() || undefined;

const INFO =
  "Hosts you added directly and organization Hosts you may access. Organization access is set in People & access › Access.";

export function HostsSettings() {
  const hub = useHubAccount();
  const inventory = useHostsSettingsInventory();
  const { daemons, status, retry } = inventory;
  const openAddProject = useOpenAddProject();
  const signedIn = hub.enabled && hub.signedIn !== null;
  const canManage = signedIn && hub.signedIn?.capabilities.manageResources === true;
  const command = buildHubConnectCommand(hub.origin ?? "", DEV_CLI_COMMAND);
  const connectionCount = useMemo(() => <HostsConnectionCount />, []);
  const refreshAction = useMemo(
    () => (
      <Button size="sm" variant="ghost" loading={daemons.isFetching} onPress={retry}>
        Refresh Hosts
      </Button>
    ),
    [daemons.isFetching, retry],
  );

  return (
    <View>
      <SettingsSection
        title="Hosts"
        titleAccessory={connectionCount}
        info={signedIn ? INFO : "Hosts added on this device and their connection status."}
        trailing={signedIn ? refreshAction : undefined}
        testID="settings-hosts-list"
      >
        {status === "error" ? (
          <Alert
            variant="error"
            title="Hosts unavailable"
            description={
              signedIn
                ? "Clisbot could not refresh your Hosts. Check your connection and use Refresh Hosts to try again."
                : "Clisbot could not load your Hub account. Check your connection and try again."
            }
          >
            {!signedIn ? (
              <Button size="sm" variant="outline" loading={hub.loading} onPress={retry}>
                Retry
              </Button>
            ) : null}
          </Alert>
        ) : null}
        <HostsSettingsContent
          inventory={inventory}
          signedIn={signedIn}
          canManage={canManage}
          openAddProject={openAddProject}
        />
      </SettingsSection>
      {canManage && hub.origin && daemons.data !== undefined ? (
        <AddHostSection command={command} />
      ) : null}
    </View>
  );
}

function HostsSettingsContent({
  inventory: { daemons, items, savedHosts, connectionStatuses, totalCount, status },
  signedIn,
  canManage,
  openAddProject,
}: {
  inventory: ReturnType<typeof useHostsSettingsInventory>;
  signedIn: boolean;
  canManage: boolean;
  openAddProject: ReturnType<typeof useOpenAddProject>;
}) {
  const hasHosts = totalCount > 0;
  if (status === "error" && !hasHosts) return null;
  let content: ReactNode = null;
  if (status === "loading" && !hasHosts) {
    content = <Text style={settingsStyles.rowHint}>Loading Hosts...</Text>;
  } else if (daemons.data !== undefined && !hasHosts && signedIn && !canManage) {
    content = (
      <Alert
        variant="info"
        title="No Hosts available"
        description="Ask an organization owner or admin to give you access to a Host and Project."
      />
    );
  } else if (!hasHosts && (!signedIn || daemons.data !== undefined)) {
    content = (
      <Alert
        variant="info"
        title="No Hosts yet"
        description={
          canManage
            ? "Follow the steps under Add a Host to connect a computer."
            : "Use Add host to connect a computer."
        }
      />
    );
  } else if (hasHosts) {
    content = (
      <View style={settingsStyles.card}>
        {items.map((item, index) => (
          <HubHostOnboardingRow
            key={item.daemonId}
            item={item}
            bordered={index > 0}
            cliCommand={DEV_CLI_COMMAND ?? "clisbot"}
            openAddProject={openAddProject}
          />
        ))}
        {savedHosts.map((host, index) => (
          <SavedHostRow
            key={host.serverId}
            host={host}
            status={connectionStatuses.get(host.serverId)}
            bordered={items.length + index > 0}
          />
        ))}
      </View>
    );
  }
  return content;
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
      <Text style={settingsStyles.rowHint}>Run on the computer you want to connect:</Text>
      <CopyableCommand command={command} />
      <Text style={settingsStyles.rowHint}>Open the terminal link and approve.</Text>
    </SettingsSection>
  );
}
