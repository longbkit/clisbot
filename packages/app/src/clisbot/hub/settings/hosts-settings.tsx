// Settings → Host → Hosts: saved machines plus authorized organization Hosts.
// Everyone sees their saved Hosts and their connection states; an
// Organization Admin also renames, disconnects, and adds Hosts. Who may use each
// Host is set in People & access › Access.

import { useRouter } from "expo-router";
import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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

export function HostsSettings() {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const inventory = useHostsSettingsInventory();
  const { daemons, status, retry } = inventory;
  const openAddProject = useOpenAddProject();
  const signedIn = hub.enabled && hub.signedIn !== null;
  const canManage = signedIn && hub.signedIn?.capabilities.manageResources === true;
  const connectionOrigin = hub.connectionOrigin === undefined ? hub.origin : hub.connectionOrigin;
  const command = connectionOrigin
    ? buildHubConnectCommand(connectionOrigin, DEV_CLI_COMMAND)
    : null;
  const connectionCount = useMemo(() => <HostsConnectionCount />, []);
  const refreshAction = useMemo(
    () => (
      <Button size="sm" variant="ghost" loading={daemons.isFetching} onPress={retry}>
        {t("hub.settings.hosts.refresh")}
      </Button>
    ),
    [daemons.isFetching, retry, t],
  );

  return (
    <View>
      <SettingsSection
        title={t("hub.settings.hosts.title")}
        titleAccessory={connectionCount}
        info={signedIn ? t("hub.settings.hosts.info") : t("hub.settings.hosts.infoSignedOut")}
        trailing={signedIn ? refreshAction : undefined}
        testID="settings-hosts-list"
      >
        {status === "error" ? (
          <Alert
            variant="error"
            title={t("hub.settings.hosts.unavailableTitle")}
            description={
              signedIn
                ? t("hub.settings.hosts.unavailableSignedIn")
                : t("hub.settings.hosts.unavailableSignedOut")
            }
          >
            {!signedIn ? (
              <Button size="sm" variant="outline" loading={hub.loading} onPress={retry}>
                {t("hub.settings.hosts.retry")}
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
  const { t } = useTranslation();
  const hasHosts = totalCount > 0;
  if (status === "error" && !hasHosts) return null;
  let content: ReactNode = null;
  if (status === "loading" && !hasHosts) {
    content = <Text style={settingsStyles.rowHint}>{t("hub.settings.hosts.loading")}</Text>;
  } else if (daemons.data !== undefined && !hasHosts && signedIn && !canManage) {
    content = (
      <Alert
        variant="info"
        title={t("hub.settings.hosts.noneAvailableTitle")}
        description={t("hub.settings.hosts.noneAvailableDescription")}
      />
    );
  } else if (!hasHosts && (!signedIn || daemons.data !== undefined)) {
    content = (
      <Alert
        variant="info"
        title={t("hub.settings.hosts.noneYetTitle")}
        description={
          canManage
            ? t("hub.settings.hosts.noneYetCanManage")
            : t("hub.settings.hosts.noneYetDevice")
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
function AddHostSection({ command }: { command: string | null }) {
  const { t } = useTranslation();
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
        {t("hub.settings.hosts.manageAccess")}
      </Button>
    ),
    [openAccess, t],
  );
  return (
    <SettingsSection
      title={t("hub.settings.hosts.addTitle")}
      info={t("hub.settings.hosts.addInfo")}
      trailing={accessLink}
    >
      {command ? <HostEnrollmentCommand command={command} /> : <NeedsHubAddress />}
    </SettingsSection>
  );
}

/** Enrolling needs an address other computers reach; relay alone carries this device only. */
function NeedsHubAddress() {
  const { t } = useTranslation();
  const router = useRouter();
  const openConnection = useCallback(
    () =>
      router.push({
        pathname: "/settings/hub/[hubSection]",
        params: { hubSection: "overview", hubPanel: "connection" },
      }),
    [router],
  );
  return (
    <Alert variant="info" description={t("hub.settings.hosts.needsAddress")}>
      <Button variant="outline" size="sm" onPress={openConnection}>
        {t("hub.settings.hosts.setUpTailscale")}
      </Button>
    </Alert>
  );
}

function HostEnrollmentCommand({ command }: { command: string }) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={settingsStyles.rowHint}>{t("hub.settings.hosts.runOnComputer")}</Text>
      <CopyableCommand command={command} />
      <Text style={settingsStyles.rowHint}>{t("hub.settings.hosts.openLinkAndApprove")}</Text>
    </>
  );
}
