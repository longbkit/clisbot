import { HomeHeaderNavigation } from "@/clisbot/home/header-navigation";
import { PanelRight } from "lucide-react-native";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChatHeaderAction } from "@/clisbot/bots/chat/header-action";
import { PHONE_SESSION_MENU_ENABLED } from "@/clisbot/session-menu/feature";
import { CompactHeader } from "@/components/headers/compact-header";
import { IconButtonChromeProvider } from "@/components/ui/icon-button-chrome";
import {
  EXPLORER_TOGGLE_KEYS,
  WorkspaceExplorerToggle,
} from "@/screens/workspace/workspace-explorer-toggle";
import { WorkspaceHeaderProjectRow } from "@/screens/workspace/workspace-header-project-row";

export { MobileWorkspaceTabSwitcher } from "./tab-switcher";

interface CompactWorkspaceHeaderProps {
  serverId: string;
  isLoading: boolean;
  title: string;
  subtitle: string;
  isSubtitleDistinct: boolean;
  onToggleExplorer: () => void;
  explorerToggleLabel: string;
  explorerToggleAccessibilityState: { expanded: boolean };
  /** Existing tab-list owner wraps only the session identity. */
  renderTitle: (identity: ReactNode) => ReactNode;
  /** Useful actions before the explorer toggle. */
  children: ReactNode;
}

/** The compact header with the workspace's project row and controls. */
export function CompactWorkspaceHeader({
  isLoading,
  title,
  subtitle,
  isSubtitleDistinct,
  onToggleExplorer,
  explorerToggleLabel,
  explorerToggleAccessibilityState,
  children,
  renderTitle,
  serverId,
}: CompactWorkspaceHeaderProps) {
  const navigationContent = useMemo(() => <HomeHeaderNavigation />, []);
  const { t } = useTranslation();
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
  const phoneActions = (
    // The section headers' 44px targets, not the compact header's 48px scope.
    <IconButtonChromeProvider value="default">
      {children}
      <ChatHeaderAction
        label={explorerToggleLabel}
        icon={PanelRight}
        onPress={onToggleExplorer}
        accessibilityState={explorerToggleAccessibilityState}
        testID="workspace-explorer-toggle"
      />
    </IconButtonChromeProvider>
  );
  const actions = PHONE_SESSION_MENU_ENABLED ? (
    phoneActions
  ) : (
    <>
      {children}
      <WorkspaceExplorerToggle
        onPress={onToggleExplorer}
        label={explorerToggleLabel}
        tooltipLabel={t("workspace.tabs.explorerSidebar.toggle")}
        tooltipKeys={EXPLORER_TOGGLE_KEYS}
        accessibilityState={explorerToggleAccessibilityState}
        mobile
      />
    </>
  );

  return (
    <CompactHeader
      navigation="menu"
      navigationContent={navigationContent}
      title={title}
      titleTestID="workspace-header-title"
      renderTitle={renderTitle}
      subtitle={projectRow}
      loading={isLoading}
      actions={actions}
    />
  );
}
