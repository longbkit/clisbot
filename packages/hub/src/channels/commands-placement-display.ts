import type { DaemonConnection } from "./daemon/client.js";
import type { CreateAgentConfig, ProjectSnapshot, WorkspaceSnapshot } from "./daemon/types.js";
import type { ChannelPlacementSelection } from "./placement-selection.js";
import { inlineCode, literalText } from "./command-reply-format.js";

export function folderName(directory: string): string {
  return directory.split(/[\\/]/u).findLast((part) => part.length > 0) ?? "";
}

export function hostLine(daemon: DaemonConnection, reference: string): string {
  const info = daemon.getServerInfo();
  const name = typeof info?.hostname === "string" ? info.hostname.trim() : "";
  return `Host: ${literalText(name || "name unavailable")} (${info?.serverId ?? reference})`;
}

export function projectLine(project: ProjectSnapshot): string {
  return `Project: ${literalText(project.projectDisplayName)} (${project.projectId})`;
}

export function workspaceDetails(workspace: WorkspaceSnapshot): string[] {
  return [
    `Workspace: ${literalText(workspace.name)} (${workspace.id})`,
    `Kind: ${workspace.workspaceKind === "worktree" ? "worktree" : "local"}`,
    `Branch: ${workspace.branch ? inlineCode(workspace.branch) : "unavailable"}`,
    `Path: ${inlineCode(workspace.workspaceDirectory)}`,
    `Last activity: ${workspace.activityAt ?? workspace.createdAt ?? "unknown"}`,
  ];
}

export function workspaceListLine(workspace: WorkspaceSnapshot): string {
  return [
    `${literalText(workspace.name)} — ${workspace.id} · ${workspace.workspaceKind === "worktree" ? "worktree" : "local"}`,
    `   Branch: ${workspace.branch ? inlineCode(workspace.branch) : "unavailable"}`,
    `   Path: ${inlineCode(workspace.workspaceDirectory)}`,
    `   Last activity: ${workspace.activityAt ?? workspace.createdAt ?? "unknown"}`,
  ].join("\n");
}

interface PlacementStatusInput {
  daemon: DaemonConnection;
  hostReference: string;
  projects: ProjectSnapshot[];
  agentId?: string | undefined;
  base: CreateAgentConfig;
  chosen: ChannelPlacementSelection | null | undefined;
  selectionValid: boolean;
}

/** Read only locations in Projects already authorized by the command owner. */
export async function placementStatus(input: PlacementStatusInput): Promise<string> {
  const { daemon, projects, chosen, base } = input;
  const read = workspaceReader(daemon);
  const agent = input.agentId
    ? (await daemon.listAgents()).find((a) => a.id === input.agentId)
    : undefined;
  const currentProject = projects.find((p) => p.projectId === agent?.projectId);
  const nextProject = projects.find(
    (p) =>
      p.projectId === (chosen?.projectId ?? base.projectId) ||
      (!chosen && p.projectRootPath === base.cwd),
  );
  const nextValid =
    input.selectionValid &&
    (!chosen || !nextProject || chosen.projectRoot === nextProject.projectRootPath);
  const workspaceId = chosen ? chosen.workspaceId : base.workspaceId;
  const [currentWorkspace, nextWorkspace] = await Promise.all([
    currentProject && agent?.workspaceId
      ? read(currentProject, agent.workspaceId, agent.cwd)
      : undefined,
    nextProject && nextValid && workspaceId ? read(nextProject, workspaceId) : undefined,
  ]);
  return [
    hostLine(daemon, input.hostReference),
    "",
    "**Current session**",
    ...(currentProject && agent
      ? [projectLine(currentProject), ...currentWorkspaceDetails(currentWorkspace, agent)]
      : [input.agentId ? "Location unavailable or you do not have access." : "None."]),
    "",
    `**Next session** — ${chosen ? "selected" : "Route default"}`,
    ...nextLocation(nextProject, nextWorkspace, workspaceId, base, nextValid),
  ].join("\n");
}

function workspaceReader(daemon: DaemonConnection) {
  const pending = new Map<string, Promise<WorkspaceSnapshot[]>>();
  return async (project: ProjectSnapshot, id: string, cwd?: string) => {
    let response = pending.get(project.projectId);
    if (!response) {
      response = daemon.listWorkspaces?.(project.projectId) ?? Promise.resolve([]);
      pending.set(project.projectId, response);
    }
    return (await response).find(
      (w) =>
        w.projectId === project.projectId && w.id === id && (!cwd || w.workspaceDirectory === cwd),
    );
  };
}

function currentWorkspaceDetails(
  workspace: WorkspaceSnapshot | undefined,
  agent: { workspaceId?: string; cwd: string },
): string[] {
  return workspace
    ? workspaceDetails(workspace)
    : [
        `Workspace: name unavailable${agent.workspaceId ? ` (${agent.workspaceId})` : ""}`,
        "Branch: unavailable",
        `Path: ${inlineCode(agent.cwd)}`,
      ];
}

function nextLocation(
  project: ProjectSnapshot | undefined,
  workspace: WorkspaceSnapshot | undefined,
  workspaceId: string | undefined,
  config: CreateAgentConfig,
  valid: boolean,
): string[] {
  if (!valid) return ["Selection expired after a Route or Host change. Select /project again."];
  if (!project) return ["Location unavailable or you do not have access."];
  if (workspace) return [projectLine(project), ...workspaceDetails(workspace)];
  if (workspaceId) return [projectLine(project), `Workspace: unavailable (${workspaceId})`];
  const worktree = config.worktree;
  let branch = project.projectKind === "git" ? "resolved when created" : "none (not a Git Project)";
  if (worktree?.mode === "branch-off")
    branch = `${worktree.newBranch} (base: ${worktree.base ?? "default"})`;
  if (worktree?.mode === "checkout-branch") branch = worktree.branch;
  if (worktree?.mode === "checkout-pr")
    branch = `resolved from PR #${worktree.prNumber} when created`;
  return [
    projectLine(project),
    "Workspace: new; created when the next session starts",
    `Kind: ${worktree ? "worktree" : "local"}`,
    `Branch: ${literalText(branch)}`,
    `Path: ${worktree ? "assigned when created" : inlineCode(project.projectRootPath)}`,
    ...(worktree ? [`Project root: ${inlineCode(project.projectRootPath)}`] : []),
  ];
}
