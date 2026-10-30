import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { ViewTabs } from "../hub/settings/view-tabs";
import { SchedulesScreen, SchedulesScreenContent } from "@/screens/schedules-screen";
import { AutomationsScreen } from "../hub/automations-screen";
import { useHubAccount } from "../hub/account-provider";
import { useBotsFeatureHosts } from "../bots/feature";
import { AutomationsHome } from "./home";
import { useTranslation } from "react-i18next";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import { useUsesPhoneTabs } from "@/clisbot/home/mobile-navigation";

type Tab = "home" | "schedules" | "automations";
const TAB_VALUES = ["home", "schedules", "automations"] as const;

/** Existing /schedules deep link stays valid; only Fusion adds the shared landing page. */
export function AutomationsLandingScreen() {
  const hub = useHubAccount();
  const botHosts = useBotsFeatureHosts();
  const phoneTabs = useUsesPhoneTabs();
  if (hub.enabled || botHosts.length > 0) return <AutomationsLandingContent />;
  // SchedulesScreen mounts its content only while focused. A phone tab stays mounted and the
  // retained panel hides it, so that gate would unmount every Host's schedules, agents and
  // directory demand on each hide and rebuild them on each show.
  return phoneTabs ? <SchedulesScreenContent /> : <SchedulesScreen />;
}
function AutomationsLandingContent() {
  // Navigation V2 names the destination Schedules / Lịch (brief C11); Hub Automations keep their tab.
  const { t } = useTranslation();
  const tabs = useMemo(
    () => TAB_VALUES.map((value) => ({ value, label: t(`home.schedulesLanding.tabs.${value}`) })),
    [t],
  );
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
      <MenuHeader
        title={NAVIGATION_V2_ENABLED ? t("navigation.sections.schedules") : "Automations"}
      />
      <View style={styles.tabs}>
        <ViewTabs tabs={tabs} value={tab} onChange={selectTab} />
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
