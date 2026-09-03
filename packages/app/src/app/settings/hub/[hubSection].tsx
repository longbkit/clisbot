import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { isHubSectionSlug, type HubSectionSlug } from "@/clisbot/hub/navigation";
import SettingsScreen from "@/screens/settings-screen";

export default function HubSettingsSectionRoute() {
  const params = useLocalSearchParams<{ hubSection?: string }>();
  const raw = typeof params.hubSection === "string" ? params.hubSection : "";
  const section: HubSectionSlug = isHubSectionSlug(raw) ? raw : "account";
  const view = useMemo(() => ({ kind: "hub" as const, section }), [section]);
  return <SettingsScreen view={view} />;
}
