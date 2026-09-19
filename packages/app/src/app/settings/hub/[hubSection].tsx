import { Redirect, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import {
  MOVED_HUB_SECTIONS,
  isHubSectionSlug,
  type HubSectionSlug,
} from "@/clisbot/hub/navigation";
import SettingsScreen from "@/screens/settings-screen";

export default function HubSettingsSectionRoute() {
  const params = useLocalSearchParams<{ hubSection?: string }>();
  const raw = typeof params.hubSection === "string" ? params.hubSection : "";
  const section: HubSectionSlug = isHubSectionSlug(raw) ? raw : "account";
  const view = useMemo(() => ({ kind: "hub" as const, section }), [section]);
  const moved = MOVED_HUB_SECTIONS[raw];
  // Keep the query (a preselected subject or resource) through the move.
  const movedHref = useMemo(
    () =>
      moved === undefined
        ? null
        : {
            pathname: "/settings/hub/[hubSection]" as const,
            params: { ...params, ...moved.params, hubSection: moved.section },
          },
    [moved, params],
  );
  if (movedHref !== null) return <Redirect href={movedHref} />;
  return <SettingsScreen view={view} />;
}
