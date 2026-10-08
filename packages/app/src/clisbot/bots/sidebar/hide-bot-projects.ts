import { useMemo } from "react";
import type { WorkspaceStructureProject } from "@/projects/workspace-structure";
import { useBotsFeatureHosts } from "../feature";
import { botsRuntime } from "../data/runtime";
import { useBotsQuery } from "../data/use-bots";

export function hideBotProjects<T extends WorkspaceStructureProject>(
  projects: T[],
  botProjectKeys: ReadonlySet<string>,
): T[] {
  if (!botProjectKeys.size) return projects;
  return projects.filter(
    (project) =>
      !project.hosts.every((host) => botProjectKeys.has(`${host.serverId}:${host.projectId}`)),
  );
}
export function useSidebarBotProjectKeys() {
  const featureHosts = useBotsFeatureHosts();
  const hosts = useMemo(
    () => featureHosts.map((h) => ({ serverId: h.serverId, serverName: h.label })),
    [featureHosts],
  );
  const query = useBotsQuery({ hosts, runtime: botsRuntime });
  return useMemo(
    () =>
      new Set(
        query.loadState.status === "loaded"
          ? query.loadState.data
              // A bot made from an existing Project shares it; that Project stays listed.
              .filter((bot) => !bot.sharesProject)
              .map((bot) => `${bot.serverId}:${bot.projectId}`)
          : [],
      ),
    [query.loadState],
  );
}
