import { memo, useCallback, useState, type ReactElement } from "react";
import { SessionPinButton } from "@/clisbot/bots/sidebar/session-pin";
import {
  SidebarWorkspaceContextMenu,
  SidebarWorkspaceMenu,
  type SidebarWorkspaceMenuProps,
} from "@/components/sidebar/sidebar-workspace-menu";
import { SidebarWorkspaceShortcutBadge } from "@/components/sidebar/sidebar-workspace-row-content";
import { useOpenKebabMenuVisibility } from "@/components/sidebar/use-open-kebab-menu-visibility";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceSessions, useWorkspaceShownAgents } from "./model";
import type { WorkspaceSessionItem } from "./select-sessions";
import { WorkspaceSessionRow, type SessionLineState } from "./session-list";

/** What a workspace's menus act with; the line supplies which workspace from its own record. */
export type SidebarWorkspaceMenuActions = Omit<
  SidebarWorkspaceMenuProps,
  | "workspaceKey"
  | "serverId"
  | "workspaceId"
  | "workspaceLabels"
  | "openInFileManagerPath"
  | "open"
  | "onOpenChange"
>;

interface StatusSessionLineProps {
  workspace: SidebarWorkspaceEntry;
  session: WorkspaceSessionItem;
  /** The workspace is the one open; only then can one of its sessions be the selected line. */
  workspaceSelected: boolean;
  menuActions: SidebarWorkspaceMenuActions;
  /** While the workspace archives, its menu stays shut, as on its row. */
  menuDisabled: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  /** The same hook a workspace press fires — closes the compact sidebar, for one. */
  onPress?: () => void;
}

/**
 * A session line on its own under a status header, where status grouping files sessions by
 * their own status. It takes the place of a workspace row, so it starts on the workspace rows'
 * rail, names its workspace, and offers that workspace's menu — right-click, or the kebab on
 * hover and always on touch — and shortcut badge. Pressing it opens the workspace on the session.
 */
export const StatusSessionLine = memo(function StatusSessionLine({
  workspace,
  session,
  workspaceSelected,
  menuActions,
  menuDisabled,
  shortcutNumber,
  showShortcutBadge,
  onPress,
}: StatusSessionLineProps): ReactElement {
  const { serverId, workspaceId } = workspace;
  const { fullTitles, details } = useSidebarWorkspaceSessions();
  const shown = useWorkspaceShownAgents({ serverId, workspaceId, enabled: workspaceSelected });
  const agentId = session.agent.id;
  let state: SessionLineState = "idle";
  if (shown.selectedAgentId === agentId) state = "selected";
  else if (shown.visibleAgentIds.has(agentId)) state = "visible";
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const badgeNumber = showShortcutBadge ? shortcutNumber : null;
  const renderTrailing = useCallback(
    ({ rowHovered, activity }: { rowHovered: boolean; activity: ReactElement | null }) => (
      <SessionLineTrailing
        workspace={workspace}
        agentId={agentId}
        rowHovered={rowHovered}
        activity={activity}
        menuActions={menuActions}
        badgeNumber={badgeNumber}
      />
    ),
    [workspace, agentId, menuActions, badgeNumber],
  );

  return (
    <SidebarWorkspaceContextMenu
      contextOnly
      accessible={false}
      contextMenuOpen={contextMenuOpen}
      onContextMenuOpenChange={setContextMenuOpen}
      workspace={workspace}
      workspaceKey={workspace.workspaceKey}
      {...menuActions}
      openInFileManagerPath={workspace.workspaceDirectory}
      disabled={menuDisabled}
      highlightStyle={undefined}
    >
      <WorkspaceSessionRow
        serverId={serverId}
        workspaceId={workspaceId}
        session={session}
        state={state}
        fullTitles={fullTitles}
        details={details}
        placement="statusGroup"
        workspaceLabel={workspace.name}
        renderTrailing={renderTrailing}
        onPress={onPress}
      />
    </SidebarWorkspaceContextMenu>
  );
});

/**
 * The end of the title line: the shortcut badge while the modifier is held, else the kebab where
 * a workspace row shows it (hover, and always on touch), else Last activity — one at a time, so
 * the title does not shift. The session pin stays beside them, as on a line under a row.
 */
function SessionLineTrailing({
  workspace,
  agentId,
  rowHovered,
  activity,
  menuActions,
  badgeNumber,
}: {
  workspace: SidebarWorkspaceEntry;
  agentId: string;
  rowHovered: boolean;
  activity: ReactElement | null;
  menuActions: SidebarWorkspaceMenuActions;
  badgeNumber: number | null;
}): ReactElement {
  const touch = useIsCompactFormFactor() || isNative;
  const kebab = useOpenKebabMenuVisibility((rowHovered || touch) && badgeNumber === null);
  let shown: ReactElement | null = activity;
  if (badgeNumber !== null) shown = <SidebarWorkspaceShortcutBadge number={badgeNumber} />;
  else if (kebab.showKebab) shown = null;
  return (
    <>
      <SessionPinButton serverId={workspace.serverId} agentId={agentId} hovered={rowHovered}>
        {shown}
      </SessionPinButton>
      {kebab.showKebab ? (
        <SidebarWorkspaceMenu
          {...kebab.menuProps}
          {...menuActions}
          workspaceKey={workspace.workspaceKey}
          serverId={workspace.serverId}
          workspaceId={workspace.workspaceId}
          workspaceLabels={workspace.labels}
        />
      ) : null}
    </>
  );
}
