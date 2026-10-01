import type { WorkspaceStructureProject } from "@/projects/workspace-structure";

/** Filter Host placements before aggregation: a regular replica must remain visible. */
export function projectBotWorkspaces<T extends WorkspaceStructureProject>(
  projects: T[],
  botKeys: ReadonlySet<string>,
  show: boolean,
): T[] {
  if (show || !botKeys.size) return projects;
  return projects.flatMap((project) => {
    const botHosts = project.hosts.filter((h) => botKeys.has(`${h.serverId}:${h.projectId}`));
    if (!botHosts.length) return [project];
    const regularHosts = project.hosts.filter((h) => !botKeys.has(`${h.serverId}:${h.projectId}`));
    if (!regularHosts.length) return [];
    const orderedHosts = [...project.hosts].sort((a, b) => b.serverId.length - a.serverId.length);
    return [
      {
        ...project,
        iconWorkingDir: regularHosts[0]!.iconWorkingDir,
        hosts: regularHosts,
        workspaceKeys: project.workspaceKeys.filter((key) =>
          regularHosts.includes(orderedHosts.find((host) => key.startsWith(`${host.serverId}:`))!),
        ),
      },
    ];
  });
}
