import { HomeHeaderNavigation } from "@/clisbot/home/header-navigation";
import { PanelRight } from "lucide-react-native";
import { Fragment, useMemo, type ReactNode } from "react";
import { ChatHeaderAction } from "@/clisbot/bots/chat/header-action";
import { PHONE_SESSION_MENU_ENABLED } from "@/clisbot/session-menu/feature";
import { usePanelStore } from "@/stores/panel-store";
import { CompactHeader } from "@/components/headers/compact-header";
import { WorkspaceHeaderProjectRow } from "@/screens/workspace/workspace-header-project-row";
import {
  useWindowLayout,
  resolveWorkspaceActionPlacement,
  resolveWorkspaceBarActions,
  WindowLayoutActions,
} from "@/window-layout";
import { IconButtonChromeProvider } from "@/components/ui/icon-button-chrome";

export { MobileWorkspaceTabSwitcher } from "./tab-switcher";

interface CompactWorkspaceHeaderProps {
  serverId: string;
  isLoading: boolean;
  title: string;
  subtitle: string;
  isSubtitleDistinct: boolean;
  explorerAction: ReactNode;
  tabSwitcher: ReactNode;
  inDesktopTitlebar: boolean;
  /**
   * Clisbot phone session header: the explorer toggle as a section-header action. Unset keeps
   * upstream's `explorerAction`.
   */
  phoneExplorerToggle?: {
    label: string;
    accessibilityState: { expanded: boolean };
    onPress: () => void;
  };
  /** Existing tab-list owner wraps only the session identity. */
  renderTitle?: (identity: ReactNode) => ReactNode;
  /** Workspace overflow menu, after Clisbot's useful actions. */
  children: ReactNode;
  headerVariant: "compact" | "full";
  isRouteFocused: boolean;
  isCompact: boolean;
}

/** The compact header with the workspace's project row and controls. */
export function CompactWorkspaceHeader({
  isLoading,
  title,
  subtitle,
  isSubtitleDistinct,
  explorerAction,
  children,
  renderTitle,
  phoneExplorerToggle,
  tabSwitcher,
  inDesktopTitlebar,
  serverId,
  headerVariant,
  isRouteFocused,
  isCompact,
}: CompactWorkspaceHeaderProps) {
  const navigationContent = useMemo(() => <HomeHeaderNavigation />, []);
  const actionsInBar = resolveWorkspaceActionPlacement(useWindowLayout()) === "vertical-bar";
  const projectRow = useMemo(
    () => (
      <WorkspaceHeaderProjectRow
        subtitle={subtitle}
        isSubtitleDistinct={isSubtitleDistinct}
        serverId={serverId}
      />
    ),
    [subtitle, isSubtitleDistinct, serverId],
  );
  const phoneChrome = PHONE_SESSION_MENU_ENABLED && phoneExplorerToggle !== undefined;
  const symbols = {
    "tab-count": tabSwitcher,
    overflow: children,
    explorer:
      phoneChrome && phoneExplorerToggle ? (
        <ChatHeaderAction
          label={phoneExplorerToggle.label}
          icon={PanelRight}
          onPress={phoneExplorerToggle.onPress}
          accessibilityState={phoneExplorerToggle.accessibilityState}
          testID="workspace-explorer-toggle"
        />
      ) : (
        explorerAction
      ),
  };
  const actions = resolveWorkspaceBarActions(headerVariant).map((symbol) => (
    <Fragment key={symbol}>{symbols[symbol]}</Fragment>
  ));
  // The section headers' 44px targets, not the compact header's 48px scope.
  const headerActions = phoneChrome ? (
    <IconButtonChromeProvider value="default">{actions}</IconButtonChromeProvider>
  ) : (
    actions
  );

  return (
    <IconButtonChromeProvider value="header-island">
      {headerVariant === "compact" ? (
        <CompactHeader
          navigation="menu"
          navigationContent={navigationContent}
          inDesktopTitlebar={inDesktopTitlebar}
          title={title}
          titleTestID="workspace-header-title"
          renderTitle={renderTitle}
          subtitle={projectRow}
          loading={isLoading}
          actions={actionsInBar ? undefined : headerActions}
        />
      ) : null}
      <WorkspaceWindowActions isRouteFocused={isRouteFocused} isCompact={isCompact}>
        {actions}
      </WorkspaceWindowActions>
    </IconButtonChromeProvider>
  );
}

// Panel changes only affect the portaled controls. Keep their subscription below the
// workspace and header so opening a sidebar does not render the chat or rebuild its actions.
function WorkspaceWindowActions({
  isRouteFocused,
  isCompact,
  children,
}: {
  isRouteFocused: boolean;
  isCompact: boolean;
  children: ReactNode;
}) {
  const active = usePanelStore(
    (state) => isRouteFocused && (!isCompact || state.mobilePanel.target === "agent"),
  );
  return <WindowLayoutActions active={active}>{children}</WindowLayoutActions>;
}
