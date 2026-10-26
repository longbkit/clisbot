import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import type { WorkspaceStructureProject } from "@/projects/workspace-structure";
import { useSessionStore } from "@/stores/session-store";

/**
 * A Host names its Quick chats folder in `server_info.quickChatRoot`; every project and chat
 * folder inside it is a Quick chat. Deciding from the folder rather than a project name keeps a
 * user's own `quick-chats` repo a Project.
 */
export function isQuickChatPath(
  path: string | null | undefined,
  root: string | null | undefined,
): boolean {
  if (!path || !root) return false;
  const trimmed = root.replace(/[\\/]+$/, "");
  return path === trimmed || path.startsWith(`${trimmed}/`) || path.startsWith(`${trimmed}\\`);
}

export function useQuickChatRoot(serverId: string | null | undefined): string | null {
  return useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.serverInfo?.quickChatRoot ?? null) : null,
  );
}

/** Whether this session may start a Quick chat; an older Host that does not say answers on use. */
export function useQuickChatAllowed(serverId: string | null | undefined): boolean {
  return useSessionStore((state) =>
    serverId ? state.sessions[serverId]?.serverInfo?.features?.quickChat !== false : false,
  );
}

export function useQuickChatRoots(serverIds: readonly string[]): ReadonlyMap<string, string> {
  const roots = useSessionStore(
    useShallow((state) =>
      serverIds.map((serverId) => state.sessions[serverId]?.serverInfo?.quickChatRoot ?? null),
    ),
  );
  return useMemo(
    () =>
      new Map(
        serverIds.flatMap((serverId, index) => {
          const root = roots[index];
          return root ? [[serverId, root] as const] : [];
        }),
      ),
    [roots, serverIds],
  );
}

/** `${serverId}:${projectId}` for each Host placement that is that Host's Quick chats. */
export function quickChatProjectKeys(
  projects: readonly WorkspaceStructureProject[],
  roots: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const project of projects)
    for (const host of project.hosts)
      if (isQuickChatPath(host.iconWorkingDir, roots.get(host.serverId)))
        keys.add(`${host.serverId}:${host.projectId}`);
  return keys;
}

/** The one project every Quick chat folds into in Navigation V2's Workspace list. */
export const QUICK_CHAT_PROJECT_VIEW_KEY = "clisbot:quick-chat";

/**
 * Navigation V2: Quick chats are ordinary Workspace sessions, so they are not set apart — every
 * Quick chat placement folds into one "Quick chat" project that sorts, scopes, pins and filters
 * like any other. It takes the first Quick chat's place in the list.
 */
export function mergeQuickChatProjects<T extends WorkspaceStructureProject>(
  projects: T[],
  keys: ReadonlySet<string>,
  name: string,
): T[] {
  if (!keys.size) return projects;
  const isQuick = (project: T) =>
    project.hosts.some((host) => keys.has(`${host.serverId}:${host.projectId}`));
  const quick = projects.filter(isQuick);
  if (!quick.length) return projects;
  const first = quick[0]!;
  const merged: T = {
    ...first,
    viewKey: QUICK_CHAT_PROJECT_VIEW_KEY,
    projectKey: null,
    projectName: name,
    hosts: quick.flatMap((project) => project.hosts),
    workspaceKeys: quick.flatMap((project) => project.workspaceKeys),
  };
  return projects.flatMap((project) => {
    if (project === first) return [merged];
    return isQuick(project) ? [] : [project];
  });
}
