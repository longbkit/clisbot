import React, { useCallback, useMemo } from "react";
import { View } from "react-native";
import { usePathname, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { Copy, Ellipsis, Globe, Import as ImportIcon, Search, Settings } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { TerminalProfile } from "@clisbot/protocol/messages";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  iconButtonChromeStyle,
  useIconButtonChromeStyle,
} from "@/components/ui/icon-button-chrome";
import { TerminalProfileIcon } from "@/components/terminal-profile-icon";
import { useLaunchableTerminalProfiles } from "@/clisbot/terminal-profiles/use-launchable-terminal-profiles";
import { getTerminalProfileIcon } from "@clisbot/protocol/terminal-profiles";
import {
  buildSettingsHostSectionRoute,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import { shortenPath } from "@/utils/shorten-path";
import { CopyProjectPathItem } from "@/clisbot/workspace-header/copy-project-path-item";
import type { Theme } from "@/styles/theme";
import {
  useWorkspaceScriptsMenuPages,
  type UseWorkspaceScriptsMenuPagesInput,
} from "@/screens/workspace/scripts";
import { usePluginWorkspaceMenu } from "@/plugins";
import { HOME_V2_ENABLED } from "@/clisbot/home/feature";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";

const ThemedEllipsis = withUnistyles(Ellipsis);
const ThemedCopy = withUnistyles(Copy);
const ThemedGlobe = withUnistyles(Globe);
const ThemedImport = withUnistyles(ImportIcon);
const ThemedSettings = withUnistyles(Settings);
const ThemedSearch = withUnistyles(Search);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const MENU_NEW_BROWSER_ICON = <ThemedGlobe size={16} uniProps={mutedColorMapping} />;
const MENU_IMPORT_ICON = <ThemedImport size={16} uniProps={mutedColorMapping} />;
const MENU_COPY_ICON = <ThemedCopy size={16} uniProps={mutedColorMapping} />;
const MENU_SETTINGS_ICON = <ThemedSettings size={16} uniProps={mutedColorMapping} />;
const MENU_SEARCH_ICON = <ThemedSearch size={16} uniProps={mutedColorMapping} />;
function WorkspaceHeaderMenuTriggerIcon() {
  return (
    <ThemedEllipsis
      size={iconButtonChromeGlyphSize("large")}
      uniProps={extraMutedIconColorMapping}
    />
  );
}

/** The ⋯ with a dot on it, for when something inside the menu needs looking at. */
function WorkspaceHeaderMenuAttentionTriggerIcon() {
  return (
    <View>
      <WorkspaceHeaderMenuTriggerIcon />
      <View style={styles.attentionDot} testID="workspace-header-menu-attention" />
    </View>
  );
}

/**
 * The compact header buttons draw at 32pt, under the 44pt touch minimum, and sit flush against
 * each other — so the slop can only grow vertically. Widening it would put two buttons' slop over
 * the same pixels, which is a worse miss than a small target.
 */
const COMPACT_HEADER_BUTTON_HIT_SLOP = { top: 8, bottom: 8 } as const;

/**
 * Actions that belong to the workspace itself rather than to a tab. Both header menus render them,
 * from the same callbacks, so the two surfaces can't drift.
 */
export interface WorkspaceHeaderWorkspaceActions {
  currentBranchName: string | null;
  /**
   * The folder the workspace works in: shown in full under Copy path, and (Clisbot Managed
   * Access) the Project whose Terminal grants decide the mobile menu's terminal rows.
   */
  workspaceDirectory?: string | null;
  showWorkspaceSetup: boolean;
  importAgentDisabled: boolean;
  copyPathDisabled: boolean;
  /** Clisbot: which workspace, so the menu can offer Copy project path beside Copy workspace path. */
  workspaceRef?: { serverId: string; workspaceId: string };
  onOpenImportSheet: () => void;
  onCopyWorkspacePath: () => void;
  onCopyBranchName: () => void;
  onOpenSetupTab: () => void;
}

function WorkspaceHeaderWorkspaceActionItems({
  currentBranchName,
  workspaceDirectory,
  showWorkspaceSetup,
  importAgentDisabled,
  copyPathDisabled,
  workspaceRef,
  onOpenImportSheet,
  onCopyWorkspacePath,
  onCopyBranchName,
  onOpenSetupTab,
}: WorkspaceHeaderWorkspaceActions) {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuItem
        testID="workspace-header-copy-path"
        leading={MENU_COPY_ICON}
        disabled={copyPathDisabled}
        onSelect={onCopyWorkspacePath}
        description={shortenPath(workspaceDirectory) || undefined}
        descriptionLines={1}
        descriptionEllipsize="middle"
      >
        {t("workspace.header.actions.copyPath")}
      </DropdownMenuItem>
      {currentBranchName ? (
        <DropdownMenuItem
          testID="workspace-header-copy-branch-name"
          leading={MENU_COPY_ICON}
          onSelect={onCopyBranchName}
        >
          {t("workspace.header.actions.copyBranchName")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        testID="workspace-header-import-agent"
        leading={MENU_IMPORT_ICON}
        disabled={importAgentDisabled}
        onSelect={onOpenImportSheet}
      >
        {t("workspace.header.actions.importSession")}
      </DropdownMenuItem>
      {workspaceRef ? <CopyProjectPathItem {...workspaceRef} /> : null}
      {showWorkspaceSetup ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            testID="workspace-header-show-setup"
            leading={MENU_SETTINGS_ICON}
            onSelect={onOpenSetupTab}
          >
            {t("workspace.header.actions.showSetup")}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

function workspaceHeaderMenuButtonStyle({
  hovered,
  pressed,
  open,
}: {
  hovered: boolean;
  pressed: boolean;
  open: boolean;
}) {
  return iconButtonChromeStyle({ size: "large", state: { hovered, pressed, open } });
}

/**
 * Wide layouts make tabs from the tab strip's `+` menu, so this one carries workspace actions only.
 */
export function WorkspaceHeaderMenuDesktop(props: WorkspaceHeaderWorkspaceActions) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID="workspace-header-menu-trigger"
        style={workspaceHeaderMenuButtonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.header.actions.workspaceActions")}
      >
        <WorkspaceHeaderMenuTriggerIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={300} testID="workspace-header-menu">
        <WorkspaceHeaderWorkspaceActionItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface HeaderMenuProfileItemProps {
  profile: TerminalProfile;
  disabled: boolean;
  onCreateTerminalWithProfile: (profile: TerminalProfile) => void;
}

function HeaderMenuProfileItem({
  profile,
  disabled,
  onCreateTerminalWithProfile,
}: HeaderMenuProfileItemProps) {
  const handleSelect = useCallback(() => {
    onCreateTerminalWithProfile(profile);
  }, [onCreateTerminalWithProfile, profile]);

  const leading = useMemo(
    () => (
      <View style={styles.headerMenuProfileIconWrapper}>
        <TerminalProfileIcon iconKey={getTerminalProfileIcon(profile)} size={16} />
      </View>
    ),
    [profile],
  );

  return (
    <DropdownMenuItem leading={leading} disabled={disabled} onSelect={handleSelect}>
      {profile.name}
    </DropdownMenuItem>
  );
}

/** The active Work route owns file search; Chat never borrows a remembered workspace. */
function WorkspaceFileSearchAction({
  serverId,
  workspaceId,
  workspaceDirectory,
}: {
  serverId: string;
  workspaceId: string;
  workspaceDirectory?: string | null;
}) {
  const { t } = useTranslation();
  const selection = parseHostWorkspaceRouteFromPathname(usePathname());
  const connected = useHostRuntimeIsConnected(serverId);
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const enabled = Boolean(
    workspaceDirectory &&
    connected &&
    selection?.serverId === serverId &&
    selection?.workspaceId === workspaceId,
  );
  const handleSearchFiles = useCallback(() => {
    if (enabled) setCommandCenterOpen(true, "files");
  }, [enabled, setCommandCenterOpen]);
  return (
    <DropdownMenuItem
      testID="workspace-header-search-files"
      leading={MENU_SEARCH_ICON}
      disabled={!enabled}
      onSelect={handleSearchFiles}
    >
      {t("settings.shortcuts.help.searchFiles")}
    </DropdownMenuItem>
  );
}

export interface WorkspaceHeaderMenuMobileProps extends WorkspaceHeaderWorkspaceActions {
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  workspaceDirectory?: string | null;
  scripts: UseWorkspaceScriptsMenuPagesInput;
  showCreateBrowserTab: boolean;
  createTerminalDisabled: boolean;
  onCreateTerminalWithProfile: (profile: TerminalProfile) => void;
  onCreateBrowser: () => void;
}

/**
 * Compact layouts have no tab strip. New agent and New terminal sit in the tab switcher's footer;
 * the rarer launches stay here alongside the workspace actions.
 *
 * The header has no room for a scripts button either, so scripts are a page of this menu, and the
 * ⋯ carries a dot while a running service is unhealthy. Plugin header buttons are rows here for the
 * same reason.
 */
export function WorkspaceHeaderMenuMobile({
  normalizedServerId,
  workspaceDirectory,
  normalizedWorkspaceId,
  scripts,
  showCreateBrowserTab,
  createTerminalDisabled,
  onCreateTerminalWithProfile,
  onCreateBrowser,
  ...workspaceActions
}: WorkspaceHeaderMenuMobileProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const triggerStyle = useIconButtonChromeStyle({ size: "large" });
  const terminalAccess = useLaunchableTerminalProfiles(
    normalizedServerId,
    workspaceDirectory ?? null,
  );
  const profiles = terminalAccess.profiles;

  const handleEditProfiles = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(normalizedServerId, "terminals") as Href);
  }, [normalizedServerId, router]);
  const scriptsMenu = useWorkspaceScriptsMenuPages(scripts);
  const pluginMenu = usePluginWorkspaceMenu(normalizedServerId, normalizedWorkspaceId);
  const pages = useMemo(
    () => [...scriptsMenu.pages, ...pluginMenu.pages],
    [scriptsMenu.pages, pluginMenu.pages],
  );

  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        testID="workspace-header-menu-trigger"
        style={triggerStyle}
        hitSlop={COMPACT_HEADER_BUTTON_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={
          scriptsMenu.needsAttention
            ? t("workspace.header.actions.workspaceActionsUnhealthy")
            : t("workspace.header.actions.workspaceActions")
        }
      >
        {scriptsMenu.needsAttention ? (
          <WorkspaceHeaderMenuAttentionTriggerIcon />
        ) : (
          <WorkspaceHeaderMenuTriggerIcon />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        width={220}
        testID="workspace-header-menu"
        pages={pages}
        sheetTitle={t("workspace.header.actions.workspaceActions")}
      >
        {scriptsMenu.trigger}
        {pluginMenu.rows}
        {pluginMenu.rows.length > 0 ? <DropdownMenuSeparator /> : null}
        {HOME_V2_ENABLED ? (
          <WorkspaceFileSearchAction
            serverId={normalizedServerId}
            workspaceId={normalizedWorkspaceId}
            workspaceDirectory={workspaceDirectory}
          />
        ) : null}
        {showCreateBrowserTab ? (
          <DropdownMenuItem
            testID="workspace-header-new-browser"
            leading={MENU_NEW_BROWSER_ICON}
            onSelect={onCreateBrowser}
          >
            {t("workspace.header.actions.newBrowser")}
          </DropdownMenuItem>
        ) : null}
        <WorkspaceHeaderWorkspaceActionItems
          {...workspaceActions}
          workspaceDirectory={workspaceDirectory}
        />
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("workspace.tabs.actions.terminalProfilesMenu")}</DropdownMenuLabel>
        {profiles.map((profile) => (
          <HeaderMenuProfileItem
            key={profile.id}
            profile={profile}
            disabled={createTerminalDisabled}
            onCreateTerminalWithProfile={onCreateTerminalWithProfile}
          />
        ))}
        {terminalAccess.canManageProfiles ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              testID="workspace-header-edit-terminal-profiles"
              onSelect={handleEditProfiles}
            >
              {t("workspace.tabs.actions.editTerminalProfiles")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ATTENTION_DOT_SIZE = 6;

const styles = StyleSheet.create((theme) => ({
  headerMenuProfileIconWrapper: {
    width: 16,
    height: 16,
  },
  // Same red as the Scripts row's unhealthy ▶, so the dot and the row it leads to agree.
  attentionDot: {
    position: "absolute",
    top: -1,
    right: -2,
    width: ATTENTION_DOT_SIZE,
    height: ATTENTION_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.red[500],
  },
}));
