import { isWeb } from "@/constants/platform";
import { router, type Href } from "expo-router";
import {
  navigateToWorkspace,
  navigateToLastWorkspace,
} from "@/stores/navigation-active-workspace-store";
import {
  buildOpenProjectRoute,
  buildProjectSettingsRoute,
  buildProjectsSettingsRoute,
  buildProviderSettingsRoute,
  buildSettingsHostSectionRoute,
  buildSettingsRoute,
  buildSettingsSectionRoute,
  type HostSectionSlug,
  type SettingsSectionSlug,
} from "@/utils/host-routes";
import type { HubSectionSlug } from "@/clisbot/hub/navigation";
import { isListTabPath } from "@/clisbot/home/mobile-navigation";
import { HOME_V2_ENABLED } from "@/clisbot/home/feature";

import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import { usePanelStore } from "@/stores/panel-store";
import {
  beginSettingsSidebarVisit,
  getSettingsSidebarReturn,
} from "@/navigation/settings-presentation/session";

export function openSettingsFromSidebar(input: {
  pathname: string;
  workspace: ActiveWorkspaceSelection | null;
  isCompact: boolean;
  route?: Href;
}): void {
  const panels = usePanelStore.getState();
  const origin = isListTabPath(input.pathname) ? { listPath: input.pathname } : input.workspace;
  if (input.isCompact && origin && panels.mobilePanel.target === "agent-list") {
    beginSettingsSidebarVisit(origin);
  } else {
    panels.showMobileAgent();
  }
  router.push(input.route ?? buildSettingsRoute());
}

export type SettingsView =
  | { kind: "plugin"; serverId: string; pluginId: string; screenId?: string }
  | { kind: "pluginListing"; serverId: string; listingId: string }
  | { kind: "root" }
  | { kind: "section"; section: SettingsSectionSlug }
  | { kind: "hub"; section: HubSectionSlug }
  | { kind: "host"; serverId: string; section: HostSectionSlug }
  | { kind: "project"; serverId: string; projectId: string }
  | { kind: "provider"; serverId: string; providerId: string };

export function openHostOverview(serverId: string): void {
  router.push(buildSettingsHostSectionRoute(serverId, "host"));
}

export function openProjectSettings(serverId: string, projectId: string): void {
  router.push(buildProjectSettingsRoute(serverId, projectId));
}

export function openProviderSettings(serverId: string, providerId: string): void {
  router.push(buildProviderSettingsRoute(serverId, providerId));
}

export function returnFromSettings(view: SettingsView): void {
  if (view.kind === "root") {
    const destination = getSettingsSidebarReturn();
    if (
      destination &&
      !("listPath" in destination) &&
      usePanelStore.getState().mobilePanel.target === "agent-list"
    ) {
      navigateToWorkspace({
        serverId: destination.serverId,
        workspaceId: destination.workspaceId,
        surface: "sidebar",
      });
      return;
    }
    // Forward may restore a different native-stack shape; browser history still owns its entry.
    if (HOME_V2_ENABLED && isWeb && window.history.length > 1) {
      window.history.back();
      return;
    }
    if (HOME_V2_ENABLED && router.canGoBack()) {
      router.back();
      return;
    }
    if (!navigateToLastWorkspace()) {
      // Detail pages such as a plugin's page are pushed onto Settings; replacing only the top
      // entry would leave the rest of Settings mounted underneath.
      if (router.canDismiss()) router.dismissAll();
      router.replace(buildOpenProjectRoute());
    }
    return;
  }

  let parent: Href = buildSettingsRoute();
  if (view.kind === "plugin" || view.kind === "pluginListing")
    parent = buildSettingsHostSectionRoute(view.serverId, "plugins");
  if (view.kind === "project") parent = buildProjectsSettingsRoute(view.serverId);
  if (view.kind === "provider") parent = buildSettingsHostSectionRoute(view.serverId, "providers");
  router.dismissTo(parent as Href);
}

/** Removing a Host exits its detail while keeping the Settings entry as the return owner. */
export function returnAfterHostRemoval(isCompactLayout: boolean): void {
  if (isCompactLayout) router.dismissTo(buildSettingsRoute());
  else router.replace(buildSettingsSectionRoute("general"));
}
