import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { useBotsFeatureHosts } from "@/clisbot/bots/feature";
import { pinKey, useResourcePins } from "@/clisbot/bots/sidebar/pins";
import { NAVIGATION_V2_ENABLED } from "@/clisbot/navigation/feature";
import {
  SidebarWorkspaceContextMenu,
  SidebarWorkspaceMenu,
  type SidebarWorkspaceMenuProps,
} from "@/components/sidebar/sidebar-workspace-menu";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceSessions, useWorkspaceShownAgents } from "./model";
import type { WorkspaceSessionItem } from "./select-sessions";
import { useProjectAbove } from "./project-above";
import { SessionRenameModal } from "./session-rename-modal";
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
  onPress?: (destination?: string) => void;
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
  // A session line renames its session as well as its workspace (rename stays the workspace's).
  const [renaming, setRenaming] = useState(false);
  const renameSession = useCallback(() => setRenaming(true), []);
  const closeRename = useCallback(() => setRenaming(false), []);
  const badgeNumber = showShortcutBadge ? shortcutNumber : null;
  const sessionPin = useSessionPinAction(serverId, agentId);
  const renderActions = useCallback(
    ({ menuOpen, onMenuOpenChange }: SessionLineActionsInput) => (
      <SidebarWorkspaceMenu
        open={menuOpen}
        onOpenChange={onMenuOpenChange}
        {...menuActions}
        onRenameSession={renameSession}
        sessionPin={sessionPin}
        workspaceKey={workspace.workspaceKey}
        serverId={workspace.serverId}
        workspaceId={workspace.workspaceId}
        workspaceLabels={workspace.labels}
      />
    ),
    [workspace, menuActions, renameSession, sessionPin],
  );

  const line = (
    <SidebarWorkspaceContextMenu
      contextOnly
      accessible={false}
      contextMenuOpen={contextMenuOpen}
      onContextMenuOpenChange={setContextMenuOpen}
      workspace={workspace}
      workspaceKey={workspace.workspaceKey}
      {...menuActions}
      onRenameSession={renameSession}
      sessionPin={sessionPin}
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
  if (!renaming) return line;
  return (
    <>
      {line}
      <SessionRenameModal serverId={serverId} agentId={agentId} visible onClose={closeRename} />
    </>
  );
});

/**
 * Navigation V2: Pin and Unpin session sit in the line's menu, so a touch list needs no pin button
 * on every line. Undefined where session pins do not exist (no Bots feature) or outside V2.
 */
function useSessionPinAction(serverId: string, agentId: string) {
  const enabled = useBotsFeatureHosts().length > 0 && NAVIGATION_V2_ENABLED;
  const { pins, toggle } = useResourcePins();
  const pinned = pins.some(
    (pin) => pinKey(pin) === pinKey({ kind: "session", serverId, id: agentId }),
  );
  return useMemo(
    () =>
      enabled
        ? { pinned, toggle: () => toggle({ kind: "session", serverId, id: agentId }) }
        : undefined,
    [enabled, pinned, toggle, serverId, agentId],
  );
}
