import type { WorkspaceStructureProject } from "@/projects/workspace-structure";
import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";

const BOT_PROJECT_PREFIX = "bot-project:";
export function isBotProject(project: { botProject?: boolean }): boolean {
  return project.botProject === true;
}

/** Split Host placements before aggregation: a regular replica must remain visible. */
export function projectBotWorkspaces<T extends WorkspaceStructureProject>(
  projects: T[],
  botKeys: ReadonlySet<string>,
  show: boolean,
): T[] {
  if (!botKeys.size) return projects;
  const allocatedKeys = new Set(projects.map((project) => project.viewKey));
  return projects.flatMap((project) => {
    const botHosts = project.hosts.filter((h) => botKeys.has(`${h.serverId}:${h.projectId}`));
    if (!botHosts.length) return [project];
    const regularHosts = project.hosts.filter((h) => !botKeys.has(`${h.serverId}:${h.projectId}`));
    let botViewKey = project.viewKey;
    if (regularHosts.length) {
      botViewKey = `${BOT_PROJECT_PREFIX}${project.viewKey}`;
      while (allocatedKeys.has(botViewKey)) botViewKey = `${BOT_PROJECT_PREFIX}${botViewKey}`;
      allocatedKeys.add(botViewKey);
    }
    const orderedHosts = [...project.hosts].sort((a, b) => b.serverId.length - a.serverId.length);
    const slice = (hosts: typeof project.hosts, bot: boolean): T => ({
      ...project,
      viewKey: bot ? botViewKey : project.viewKey,
      ...(bot ? { botProject: true } : {}),
      iconWorkingDir: hosts[0]!.iconWorkingDir,
      hosts,
      workspaceKeys: project.workspaceKeys.filter((key) =>
        hosts.includes(orderedHosts.find((host) => key.startsWith(`${host.serverId}:`))!),
      ),
    });
    return [
      ...(regularHosts.length ? [slice(regularHosts, false)] : []),
      ...(show ? [slice(botHosts, true)] : []),
    ];
  });
}

export function splitBotStatusGroups(groups: SidebarWorkspaceGroup[]) {
  if (!groups.some((group) => group.rows.some(isBotProject))) return { regular: groups, bots: [] };
  const project = (bot: boolean) =>
    groups.flatMap((group) => {
      const rows = group.rows.filter((row) => isBotProject(row) === bot);
      return rows.length
        ? [{ ...group, key: bot ? `${BOT_PROJECT_PREFIX}${group.key}` : group.key, rows }]
        : [];
    });
  return { regular: project(false), bots: project(true) };
}
