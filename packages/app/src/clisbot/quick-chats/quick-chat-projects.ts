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
