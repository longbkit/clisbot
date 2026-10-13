import type { ClisbotApi } from "@clisbot/client";
import type { QueryClient } from "@tanstack/react-query";
import type { PluginRequirements } from "@clisbot/protocol/messages";
import type {
  PluginAttachmentSourceContribution,
  PluginCleanup,
  PluginThemeContribution,
} from "@clisbot/plugin";
import type {
  PluginCommandCenterItemContribution,
  PluginClientSlashCommandContribution,
  PluginComposerPillContribution,
  PluginSidebarContribution,
  PluginSidebarItemContribution,
  PluginScreenContribution,
  PluginSettingsScreenContribution,
  PluginTimelineRendererContribution,
  PluginTimelineTransformerContribution,
  PluginPanelLocation,
  PluginWorkspacePanelContribution,
} from "@clisbot/plugin/client";

export type PluginSidebarSection = "header" | "footer";

export type EvaluatedPluginWorkspacePanelContribution = PluginWorkspacePanelContribution & {
  locations: readonly PluginPanelLocation[];
};

export interface EvaluatedPlugin {
  id: string;
  cleanup: PluginCleanup;
  surfaces: PluginScreenContribution[];
  settingsScreens: PluginSettingsScreenContribution[];
  sidebarItems: Record<PluginSidebarSection, PluginSidebarItemContribution[]>;
  // COMPAT(pluginSidebarAliases): added in v0.11.0, remove after 2027-03-29
  /** `addSidebarItem` registrations, so `/plugin/<id>/sidebar/<item>` routes keep resolving. */
  legacySidebarItems: PluginSidebarContribution[];
  workspacePanels: EvaluatedPluginWorkspacePanelContribution[];
  commandCenterItems: PluginCommandCenterItemContribution[];
  clientSlashCommands: PluginClientSlashCommandContribution[];
  attachmentSources: PluginAttachmentSourceContribution[];
  themes: PluginThemeContribution[];
  timelineTransformers: PluginTimelineTransformerContribution[];
  timelineRenderers: PluginTimelineRendererContribution[];
}

export interface InstalledPlugin extends EvaluatedPlugin {
  lifetime: AbortController;
  /** The plugin's one Clisbot client, `useClisbot()` in every surface; disposed at teardown. */
  clisbot: ClisbotApi;
  /** Calls one of the plugin's server RPC methods on its host. */
  invoke(method: string, input: unknown): Promise<unknown>;
  serverId: string;
  requirements?: PluginRequirements;
  clientBundle: string;
  queryClient: QueryClient;
}

export type {
  PluginAttachmentSourceContribution,
  PluginCommandCenterItemContribution,
  PluginClientSlashCommandContribution,
  PluginComposerPillContribution,
  PluginSidebarContribution,
  PluginSidebarItemContribution,
  PluginScreenContribution,
  PluginSettingsScreenContribution,
  PluginThemeContribution,
  PluginTimelineRendererContribution,
  PluginTimelineTransformerContribution,
  PluginWorkspacePanelContribution,
};
