// Settings → Hosts: the machines enrolled in the organization that run Agents.
// Who may use each one is set in People › Access.

import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { useHubAccount } from "../account-provider";
import { HubDaemonsSchema } from "../contracts";
import { useHubResource } from "./hub-resource";
import { ManagedHostRow } from "./managed-host-row";
import { EmptyRow, ResourceFeedback } from "./resource-rows";

const INFO =
  "Machines enrolled in your organization that run Agents. Who may use each one is set in People › Access.";

export function HostsSettings() {
  const hub = useHubAccount();
  const router = useRouter();
  const daemons = useHubResource("daemons", HubDaemonsSchema);
  const refresh = useCallback(() => void daemons.refetch(), [daemons]);
  const openAccess = useCallback(
    () =>
      router.push({
        pathname: "/settings/hub/[hubSection]",
        params: { hubSection: "team", view: "access" },
      }),
    [router],
  );
  const trailing = useMemo(
    () => (
      <Button size="sm" variant="ghost" loading={daemons.isFetching} onPress={refresh}>
        Refresh
      </Button>
    ),
    [daemons.isFetching, refresh],
  );
  return (
    <SettingsSection title="Hosts" info={INFO} trailing={trailing}>
      <ResourceFeedback query={daemons} />
      {daemons.data === undefined ? null : (
        <View style={settingsStyles.card}>
          {daemons.data.daemons.length === 0 ? (
            <EmptyRow message="No Host is enrolled in this organization yet." />
          ) : (
            daemons.data.daemons.map((daemon, index) => (
              <ManagedHostRow
                key={`${hub.signedIn?.account.id}:${daemon.id}`}
                daemon={daemon}
                bordered={index > 0}
              />
            ))
          )}
        </View>
      )}
      <Button size="sm" variant="ghost" onPress={openAccess}>
        Who can use Hosts: People › Access
      </Button>
    </SettingsSection>
  );
}
