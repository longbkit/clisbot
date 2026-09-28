import { useCallback, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { ViewTabs } from "../hub/settings/view-tabs";
import { SchedulesScreen, SchedulesScreenContent } from "@/screens/schedules-screen";
import { AutomationsScreen } from "../hub/automations-screen";
import { useHubAccount } from "../hub/account-provider";
import { useBotsFeatureHosts } from "../bots/feature";
import { AutomationsHome } from "./home";

type Tab = "home" | "schedules" | "automations";
const TABS = [
  { value: "home", label: "Home" },
  { value: "schedules", label: "Schedules" },
  { value: "automations", label: "Automations" },
] as const;

/** Existing /schedules deep link stays valid; only Fusion adds the shared landing page. */
export function AutomationsLandingScreen() {
  const hub = useHubAccount();
  const botHosts = useBotsFeatureHosts();
  return hub.enabled || botHosts.length > 0 ? <AutomationsLandingContent /> : <SchedulesScreen />;
}
function AutomationsLandingContent() {
  const [tab, setTab] = useState<Tab>("home");
  const [create, setCreate] = useState(0);
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(["home"]));
  const selectTab = useCallback((value: Tab) => {
    setVisited((current) => new Set([...current, value]));
    setTab(value);
  }, []);
  const schedules = useCallback(() => selectTab("schedules"), [selectTab]);
  const automations = useCallback((newAutomation: boolean) => {
    if (newAutomation) setCreate((value) => value + 1);
    setVisited((current) => new Set([...current, "automations"]));
    setTab("automations");
  }, []);
  return (
    <View style={styles.page}>
      <MenuHeader title="Automations" />
      <View style={styles.tabs}>
        <ViewTabs tabs={TABS} value={tab} onChange={selectTab} />
      </View>
      <View style={[styles.content, tab !== "home" && styles.hidden]}>
        <AutomationsHome onSchedules={schedules} onAutomations={automations} />
      </View>
      {visited.has("schedules") ? (
        <View style={[styles.content, tab !== "schedules" && styles.hidden]}>
          <SchedulesScreenContent embedded />
        </View>
      ) : null}
      {visited.has("automations") ? (
        <View style={[styles.content, tab !== "automations" && styles.hidden]}>
          <AutomationsScreen key={create} embedded initialCreate={create > 0} />
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { flex: 1, minHeight: 0 },
  hidden: { display: "none" },
  tabs: { paddingHorizontal: theme.spacing[4] },
}));
