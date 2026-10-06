import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type { StatusGroup } from "@/hooks/sidebar-status-view-model";

export interface SidebarShortcutWorkspaceTarget {
  serverId: string;
  workspaceId: string;
  /**
   * Clisbot: set when the line is a session — Status grouping with Agent sessions on lists
   * sessions, and the shortcut opens the workspace on that session.
   */
  agentId?: string;
}

export interface SidebarShortcutModel {
  shortcutTargets: SidebarShortcutWorkspaceTarget[];
  shortcutIndexByWorkspaceKey: Map<string, number>;
}

export interface SidebarShortcutSection {
  workspaces: readonly SidebarWorkspacePlacement[];
  collapsed?: boolean;
}

function createShortcutTarget(
  workspace: SidebarWorkspacePlacement,
): SidebarShortcutWorkspaceTarget {
  return {
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
  };
}

export function buildSidebarShortcutModel(input: {
  projects: SidebarProjectEntry[];
  collapsedProjectKeys: ReadonlySet<string>;
  shortcutLimit?: number;
}): SidebarShortcutModel {
  return buildSidebarShortcutSections({
    sections: input.projects.map((project) => ({
      workspaces: project.workspaces,
      collapsed: input.collapsedProjectKeys.has(project.viewKey),
    })),
    shortcutLimit: input.shortcutLimit,
  });
}

export function buildStatusSidebarShortcutModel(input: {
  groups: readonly StatusGroup[];
  collapsedStatusGroupKeys?: ReadonlySet<string>;
  shortcutLimit?: number;
}): SidebarShortcutModel {
  return buildSidebarShortcutSections({
    sections: input.groups.map((group) => ({
      workspaces: group.rows,
      collapsed: input.collapsedStatusGroupKeys?.has(group.bucket),
    })),
    shortcutLimit: input.shortcutLimit,
  });
}

export function buildSidebarShortcutSections(input: {
  sections: readonly SidebarShortcutSection[];
  shortcutLimit?: number;
}): SidebarShortcutModel {
  const maxShortcuts = Math.max(0, Math.floor(input.shortcutLimit ?? 9));
  const shortcutTargets: SidebarShortcutWorkspaceTarget[] = [];
  const shortcutIndexByWorkspaceKey = new Map<string, number>();

  for (const section of input.sections) {
    if (section.collapsed) {
      continue;
    }

    for (const workspace of section.workspaces) {
      if (shortcutTargets.length >= maxShortcuts) {
        break;
      }

      const shortcutNumber = shortcutTargets.length + 1;
      shortcutTargets.push(createShortcutTarget(workspace));
      shortcutIndexByWorkspaceKey.set(workspace.workspaceKey, shortcutNumber);
    }
  }

  return { shortcutTargets, shortcutIndexByWorkspaceKey };
}

export function getRelativeSidebarShortcutTarget(input: {
  targets: readonly SidebarShortcutWorkspaceTarget[];
  currentTarget: SidebarShortcutWorkspaceTarget | null;
  delta: 1 | -1;
}): SidebarShortcutWorkspaceTarget | null {
  if (input.targets.length === 0) {
    return null;
  }

  if (!input.currentTarget) {
    return input.targets[input.delta > 0 ? 0 : input.targets.length - 1] ?? null;
  }

  const currentTarget = input.currentTarget;
  const sameWorkspace = (target: SidebarShortcutWorkspaceTarget) =>
    target.serverId === currentTarget.serverId && target.workspaceId === currentTarget.workspaceId;
  // A workspace can own several session lines; the one you are in wins over its first line.
  const exactIndex = currentTarget.agentId
    ? input.targets.findIndex(
        (target) => sameWorkspace(target) && target.agentId === currentTarget.agentId,
      )
    : -1;
  const currentIndex = exactIndex >= 0 ? exactIndex : input.targets.findIndex(sameWorkspace);
  if (currentIndex < 0) {
    return input.targets[input.delta > 0 ? 0 : input.targets.length - 1] ?? null;
  }

  const nextIndex = (currentIndex + input.delta + input.targets.length) % input.targets.length;
  return input.targets[nextIndex] ?? null;
}
