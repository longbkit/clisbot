import { useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ViewTabs, type ViewTab } from "../hub/settings/view-tabs";
import {
  ConnectorsGrantSection,
  type ConnectorsGrantSectionProps,
} from "./connectors-grant-section";
import { isAccessDenied } from "./data";
import { useHostConnectorsFeature } from "./feature";
import { useProjectGrant } from "./project-grants";

/**
 * Project settings and Bot settings as two views, Settings and Tools (the Clisbot tools, the
 * browser tools and the Connectors its agents may use), one tap away instead of below every
 * other section. The view tabs are the ones Channels and
 * Automations use. Without Connectors on the Host, or for someone who may not read them, the
 * page is its settings alone, as upstream has it.
 */

type SettingsView = "settings" | "tools";

const TABS: readonly ViewTab<SettingsView>[] = [
  { value: "settings", label: "Settings" },
  { value: "tools", label: "Tools" },
];

/** The route query that opens the Tools view directly; `view=connectors` is its first name. */
export const TOOLS_VIEW_QUERY = "view=tools";

export function WithConnectorsTab({
  children,
  ...grant
}: ConnectorsGrantSectionProps & { children: ReactNode }) {
  const enabled = useHostConnectorsFeature(grant.serverId);
  const saved = useProjectGrant(grant.serverId, grant.projectId, enabled);
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<SettingsView>(
    params.view === "tools" || params.view === "connectors" ? "tools" : "settings",
  );
  if (!enabled || isAccessDenied(saved.error)) return children;
  return (
    <>
      <View style={styles.tabs}>
        <ViewTabs tabs={TABS} value={view} onChange={setView} />
      </View>
      {view === "settings" ? children : <ConnectorsGrantSection {...grant} />}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  tabs: { marginBottom: theme.spacing[6] },
}));
