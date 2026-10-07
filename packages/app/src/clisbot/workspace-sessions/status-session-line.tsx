import { memo, useCallback, useState, type ReactElement } from "react";
import {
  SidebarWorkspaceContextMenu,
  SidebarWorkspaceMenu,
  type SidebarWorkspaceMenuProps,
} from "@/components/sidebar/sidebar-workspace-menu";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceSessions, useWorkspaceShownAgents } from "./model";
import type { WorkspaceSessionItem } from "./select-sessions";
import { useProjectAbove } from "./project-above";
import type { SessionLineActionsInput } from "./session-line-trailing";
import {
  WorkspaceSessionRow,
  type SessionLinePlacement,
  type SessionLineState,
} from "./session-list";

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
  /** Under a group header, or flush in a list that has none. */
  placement: Extract<SessionLinePlacement, "statusGroup" | "topLevel">;
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
 * A session line on its own in the session groupings — under a status or project header, or in
 * the Session grouping's flat list. It takes the place of a workspace row, so it starts on the
 * workspace rows' rail, names its workspace, and offers that workspace's menu — right-click, or the kebab on
 * hover and always on touch — and shortcut badge. Pressing it opens the workspace on the session.
 */
export const StatusSessionLine = memo(function StatusSessionLine({
  workspace,
  session,
  placement,
  workspaceSelected,
  menuActions,
  menuDisabled,
  shortcutNumber,
  showShortcutBadge,
  onPress,
}: StatusSessionLineProps): ReactElement {
  const { serverId, workspaceId } = workspace;
  const { fullTitles, details } = useSidebarWorkspaceSessions();
  const projectAbove = useProjectAbove();
  const shown = useWorkspaceShownAgents({ serverId, workspaceId, enabled: workspaceSelected });
  const agentId = session.agent.id;
  let state: SessionLineState = "idle";
  if (shown.selectedAgentId === agentId) state = "selected";
  else if (shown.visibleAgentIds.has(agentId)) state = "visible";
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const badgeNumber = showShortcutBadge ? shortcutNumber : null;
  const renderActions = useCallback(
    ({ menuOpen, onMenuOpenChange }: SessionLineActionsInput) => (
      <SidebarWorkspaceMenu
        open={menuOpen}
        onOpenChange={onMenuOpenChange}
        {...menuActions}
        workspaceKey={workspace.workspaceKey}
        serverId={workspace.serverId}
        workspaceId={workspace.workspaceId}
        workspaceLabels={workspace.labels}
      />
    ),
    [workspace, menuActions],
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
        placement={placement}
        workspaceLabel={workspace.name}
        projectLabel={projectAbove ? workspace.projectName : undefined}
        badgeNumber={badgeNumber}
        renderActions={renderActions}
        onPress={onPress}
      />
    </SidebarWorkspaceContextMenu>
  );
});
