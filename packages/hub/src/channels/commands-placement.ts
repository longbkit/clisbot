import type { ChannelAccessStore } from "../db/channel-access.js";
import type { CompiledChannelAccount, CompiledRoute } from "./config/compile.js";
import type { DaemonConnection } from "./daemon/client.js";
import type { ProjectSnapshot, WorkspaceSnapshot, CreateAgentConfig } from "./daemon/types.js";
import { commandAccessRequest } from "./commands-context.js";
import type { ChannelPlaneDeps, InboundMessage } from "./plane/types.js";
import type { ChannelTextCommand } from "./commands.js";

export interface PlacementCommandContext {
  command: Extract<ChannelTextCommand, { name: "project" | "worktree" }>;
  plane: ChannelPlaneDeps;
  daemon: DaemonConnection;
  store: Pick<ChannelAccessStore, "findConversationSelection">;
  message: InboundMessage;
  account: CompiledChannelAccount;
  route: CompiledRoute;
  selectionKey: Parameters<ChannelAccessStore["findConversationSelection"]>[0];
  routeConfig: CreateAgentConfig;
}

export interface PlacementCommandResult {
  text: string;
  selection?: {
    selectedProjectId: string | null;
    selectedProjectRoot: string | null;
    selectedWorkspaceId: string | null;
  };
}

export async function runPlacementCommand(
  input: PlacementCommandContext,
): Promise<PlacementCommandResult> {
  return input.command.name === "project" ? projectCommand(input) : worktreeCommand(input);
}

async function projectCommand(input: PlacementCommandContext): Promise<PlacementCommandResult> {
  const value = input.command.value?.trim() ?? "";
  if (/^clear$/iu.test(value)) {
    return {
      text: "Project selection cleared; the next session uses the Route Project.",
      selection: { selectedProjectId: null, selectedProjectRoot: null, selectedWorkspaceId: null },
    };
  }
  const projects = await readProjects(input.daemon);
  const visibleProjects = await filterAuthorizedProjects(input, projects);
  if (value === "" || /^(list|search)(?:\s|$)/iu.test(value)) {
    const query = /^search\s+(.+)$/iu.exec(value)?.[1]?.toLowerCase() ?? "";
    const lines = visibleProjects
      .filter((project) => projectText(project).toLowerCase().includes(query))
      .map(
        (project) =>
          project.projectId +
          " — " +
          project.projectDisplayName +
          " (" +
          project.projectRootPath +
          ")",
      );
    return { text: "Available projects:\n" + (lines.join("\n") || "none") + "." };
  }
  const project = findProject(visibleProjects, value);
  if (!project) throw new Error("Unknown or ambiguous Project; use /project list.");
  await authorizeProject(input, project.projectId, "project.use");
  return {
    text: "Selected Project " + project.projectDisplayName + ". Use /new or /fork to apply it.",
    selection: {
      selectedProjectId: project.projectId,
      selectedProjectRoot: project.projectRootPath,
      selectedWorkspaceId: null,
    },
  };
}

async function worktreeCommand(input: PlacementCommandContext): Promise<PlacementCommandResult> {
  const value = input.command.value?.trim() ?? "";
  if (/^clear$/iu.test(value)) {
    const current = await input.store.findConversationSelection(input.selectionKey);
    return {
      text: "Worktree selection cleared; the next session uses the selected Project's default workspace.",
      selection: {
        selectedProjectId: current?.selectedProjectId ?? null,
        selectedProjectRoot: current?.selectedProjectRoot ?? null,
        selectedWorkspaceId: null,
      },
    };
  }
  const create = /^new\s+([^\s]+)(?:\s+([^\s]+))?$/iu.exec(value);
  if (create) {
    const current = await input.store.findConversationSelection(input.selectionKey);
    const projectId = current?.selectedProjectId ?? input.routeConfig.projectId;
    const projectRoot = current?.selectedProjectRoot ?? input.routeConfig.cwd;
    if (!projectId) throw new Error("Select a Project first with /project <id>.");
    await authorizeProject(input, projectId, "workspace.create");
    const created = await input.daemon.createWorkspace({
      cwd: projectRoot,
      projectId,
      source: {
        kind: "worktree",
        cwd: projectRoot,
        projectId,
        action: "branch-off",
        branchName: create[1]!,
        ...(create[2] === undefined ? {} : { baseBranch: create[2] }),
      },
    });
    return {
      text: "Created worktree " + created.workspaceId + ". Use /new or /fork to continue there.",
      selection: {
        selectedProjectId: projectId,
        selectedProjectRoot: projectRoot,
        selectedWorkspaceId: created.workspaceId,
      },
    };
  }
  const worktrees = (await readWorkspaces(input.daemon)).filter(
    (workspace) => workspace.workspaceKind === "worktree",
  );
  const visibleWorktrees = await filterAuthorizedWorktrees(input, worktrees);
  if (value === "" || /^list$/iu.test(value)) {
    const lines = visibleWorktrees.map(
      (workspace) =>
        workspace.id + " — " + workspace.name + " (" + workspace.projectDisplayName + ")",
    );
    return { text: "Available worktrees:\n" + (lines.join("\n") || "none") + "." };
  }
  const resume = /^resume\s+(.+)$/iu.exec(value);
  if (resume) {
    const workspace = findWorkspace(visibleWorktrees, resume[1]!.trim());
    if (!workspace) throw new Error("Unknown worktree; use /worktree list.");
    await authorizeProject(input, workspace.projectId, "project.use");
    return {
      text: "Selected worktree " + workspace.name + ". Use /new or /fork to continue there.",
      selection: {
        selectedProjectId: workspace.projectId,
        selectedProjectRoot: workspace.projectRootPath,
        selectedWorkspaceId: workspace.id,
      },
    };
  }
  throw new Error("Usage: /worktree list | new <branch> [base] | resume <workspace-id> | clear");
}

async function readProjects(daemon: DaemonConnection): Promise<ProjectSnapshot[]> {
  if (!daemon.listProjects) throw new Error("This Host does not support Project selection.");
  return daemon.listProjects();
}

async function readWorkspaces(daemon: DaemonConnection): Promise<WorkspaceSnapshot[]> {
  if (!daemon.listWorkspaces) throw new Error("This Host does not support worktree selection.");
  return daemon.listWorkspaces();
}

async function filterAuthorizedProjects(
  input: PlacementCommandContext,
  projects: readonly ProjectSnapshot[],
): Promise<ProjectSnapshot[]> {
  return (
    await Promise.all(
      projects.map(async (project) => {
        try {
          await authorizeProject(input, project.projectId, "project.use");
          return project;
        } catch {
          return undefined;
        }
      }),
    )
  ).filter((project): project is ProjectSnapshot => project !== undefined);
}

async function filterAuthorizedWorktrees(
  input: PlacementCommandContext,
  worktrees: readonly WorkspaceSnapshot[],
): Promise<WorkspaceSnapshot[]> {
  return (
    await Promise.all(
      worktrees.map(async (workspace) => {
        try {
          await authorizeProject(input, workspace.projectId, "project.use");
          return workspace;
        } catch {
          return undefined;
        }
      }),
    )
  ).filter((workspace): workspace is WorkspaceSnapshot => workspace !== undefined);
}

async function authorizeProject(
  input: PlacementCommandContext,
  projectId: string,
  privilege: "project.use" | "workspace.create",
): Promise<void> {
  if (input.route.target.kind !== "agent") throw new Error("A direct route is required.");
  const target = input.plane.resolveAgentAccessTarget(input.route.target);
  const decision = await input.plane.commandAccess?.authorizeChannelPrivilege(
    commandAccessRequest(input.plane, input.message, input.account, input.route, privilege, {
      ...target,
      projectId,
    }),
  );
  if (decision?.allowed !== true)
    throw new Error("Access does not grant " + privilege + " for this Project.");
}

function projectText(project: ProjectSnapshot): string {
  return project.projectId + " " + project.projectDisplayName + " " + project.projectRootPath;
}

function findProject(
  projects: readonly ProjectSnapshot[],
  value: string,
): ProjectSnapshot | undefined {
  const normalized = value.toLowerCase();
  const matches = projects.filter(
    (project) =>
      project.projectId.toLowerCase() === normalized ||
      project.projectDisplayName.toLowerCase() === normalized ||
      project.projectRootPath.toLowerCase() === normalized,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function findWorkspace(
  worktrees: readonly WorkspaceSnapshot[],
  value: string,
): WorkspaceSnapshot | undefined {
  const normalized = value.toLowerCase();
  const matches = worktrees.filter(
    (workspace) =>
      workspace.id.toLowerCase() === normalized ||
      workspace.name.toLowerCase() === normalized ||
      workspace.worktreeSlug?.toLowerCase() === normalized,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
