import {
  discoveryArguments,
  pageText,
  search,
  tokenizePlacementArguments,
} from "./commands-discovery.js";
export { tokenizePlacementArguments } from "./commands-discovery.js";
import { createHash, randomUUID } from "node:crypto";
import { ChannelWorktreeCommands } from "./commands-worktree.js";
import { commitLine } from "./commands-git-display.js";
import type { ChannelStore } from "../db/channels.js";
import type { CreateAgentConfig, ProjectSnapshot, WorkspaceSnapshot } from "./daemon/types.js";
import type { DaemonConnection } from "./daemon/client.js";
import type { ChannelAgentAccessTarget, ChannelPlaneDeps } from "./plane/types.js";
import type { LifecycleCommandContext } from "./commands-lifecycle.js";
import { commandAccessRequest } from "./commands-context.js";
import { deriveBindingKey, routePosition } from "./bindings/index.js";
import { inlineCode, literalText } from "./command-reply-format.js";
import {
  folderName,
  hostLine,
  projectLine,
  workspaceDetails,
  workspaceListLine,
  placementStatus,
} from "./commands-placement-display.js";
import {
  placementRouteFingerprint,
  assertWorktreeProject,
  placementTarget,
  type ChannelPlacementSelection,
} from "./placement-selection.js";

interface PlacementDependencies {
  plane: ChannelPlaneDeps;
  daemon: DaemonConnection;
  store: ChannelStore;
  baseConfig(context: LifecycleCommandContext): Promise<CreateAgentConfig>;
  authorizeConfiguration(
    input: LifecycleCommandContext & {
      config: CreateAgentConfig;
      accessTarget: ChannelAgentAccessTarget;
    },
  ): Promise<{ allowed: boolean; reason?: string }>;
}

export function placementSelectionKey(organizationId: string, context: LifecycleCommandContext) {
  return {
    organizationId,
    channel: context.message.channel,
    accountId: context.account.accountId,
    ...deriveBindingKey(context.message, context.route),
  };
}

interface PlacementScope {
  context: LifecycleCommandContext;
  key: ReturnType<typeof placementSelectionKey>;
  chosen: ChannelPlacementSelection | null | undefined;
  base: CreateAgentConfig;
  target: ChannelAgentAccessTarget;
  projects: ProjectSnapshot[];
}

export class ChannelPlacementCommands {
  constructor(private readonly deps: PlacementDependencies) {}

  async run(
    command: { name: "project" | "workspace" | "branch" | "worktree"; value?: string },
    context: LifecycleCommandContext,
  ): Promise<string> {
    const scope = await this.prepare(context);
    const args = tokenizePlacementArguments(command.value ?? "");
    if (command.name === "worktree") return this.worktree(args, scope);
    if (!args.length)
      return [
        await this.status(scope, command.name === "branch"),
        "",
        `List: /${command.name} list · Search: /${command.name} search <text>`,
      ].join("\n");
    if (args[0] === "clear") return this.clear(command.name, args, scope);
    if (command.name === "project") return this.project(args, scope);
    const project = this.selectedProject(scope);
    if (command.name === "branch") return this.branch(args, scope, project);
    if (args[0] === "new")
      return this.createWorkspace(args.slice(1), scope, project, command.value);
    return this.workspace(args, scope, project);
  }

  private async prepare(context: LifecycleCommandContext): Promise<PlacementScope> {
    if (context.route.target.kind !== "agent") throw new Error("A direct Route is required.");
    if (context.route.defaults.workspace?.commands === false)
      throw new Error("Project/Workspace commands are disabled on this Route.");
    if (this.deps.daemon.getServerInfo()?.features?.["workspaceMultiplicity"] !== true)
      throw new Error("Update this Host to support Project/Workspace commands.");
    const key = placementSelectionKey(this.deps.plane.organizationId, context);
    const selection = await this.deps.store.access.findConversationSelection(key);
    return {
      context,
      key,
      chosen: selection?.selectedPlacement,
      base: await this.deps.baseConfig(context),
      target: this.deps.plane.resolveAgentAccessTarget(context.route.target),
      projects: await this.projects(context),
    };
  }

  private stamp(
    scope: PlacementScope,
    project: ProjectSnapshot,
    workspaceId?: string,
  ): ChannelPlacementSelection {
    return {
      projectId: project.projectId,
      projectRoot: project.projectRootPath,
      ...(workspaceId ? { workspaceId } : {}),
      daemonReference: scope.target.daemonReference,
      routePosition: routePosition(scope.context.account, scope.context.route),
      routeFingerprint: placementRouteFingerprint(scope.context.route),
    };
  }

  private async save(scope: PlacementScope, selectedPlacement: ChannelPlacementSelection | null) {
    await this.deps.store.access.setConversationSelection(scope.key, {
      selectedPlacement,
      selectedBy: scope.context.message.senderIdentity,
    });
    scope.chosen = selectedPlacement;
  }

  private async authorize(
    scope: PlacementScope,
    project: ProjectSnapshot,
    workspace?: WorkspaceSnapshot,
    inheritWorktree = true,
  ) {
    const placement = this.stamp(scope, project, workspace?.id);
    const { worktree: routeWorktree, workspaceId: _workspace, ...config } = scope.base;
    const worktree = inheritWorktree ? routeWorktree : undefined;
    assertWorktreeProject({ ...config, ...(worktree ? { worktree } : {}) }, project, workspace?.id);
    const result = await this.deps.authorizeConfiguration({
      ...scope.context,
      accessTarget: placementTarget(placement),
      config: {
        ...config,
        cwd: workspace?.workspaceDirectory ?? project.projectRootPath,
        projectId: project.projectId,
        ...(workspace ? { workspaceId: workspace.id } : {}),
        ...(!workspace && worktree ? { worktree } : {}),
      },
    });
    if (!result.allowed)
      throw new Error(
        result.reason ?? "You cannot create an Agent with this configuration in that Project.",
      );
    return placement;
  }

  private async acknowledgement(scope: PlacementScope, label: string) {
    const location = scope.key.externalThreadId === null ? "this conversation" : "this thread";
    let details: string;
    try {
      details = await this.status(scope);
    } catch {
      details = `${hostLine(this.deps.daemon, scope.target.daemonReference)}\nLocation details unavailable; use /project or /workspace to refresh.`;
    }
    return `${label}\n\n${details}\n\nApplies to the next session in ${location}. The current session keeps its location. Use /new or /fork to start there.`;
  }

  private async clear(name: string, args: string[], scope: PlacementScope) {
    if (args.length !== 1 || name === "branch") throw new Error(`Usage: /${name} clear`);
    const { projects, chosen, base } = scope;
    const project =
      name === "workspace" && chosen
        ? projects.find((p) => p.projectId === chosen.projectId)
        : projects.find((p) => p.projectId === base.projectId || p.projectRootPath === base.cwd);
    if (!project) throw new Error("The default Project is unavailable or you do not have access.");
    await this.authorize(scope, project);
    await this.save(scope, name === "workspace" && chosen ? this.stamp(scope, project) : null);
    return this.acknowledgement(
      scope,
      name === "project"
        ? "Project and Workspace selections cleared; using the Route default."
        : "Workspace selection cleared; keeping the Project.",
    );
  }

  private async project(args: string[], scope: PlacementScope) {
    const action = args[0];
    if (action === "list" || action === "search") {
      const parsed = discoveryArguments(args);
      if (parsed.worktree) throw new Error("--worktree only applies to /workspace list or search.");
      const matches = search(scope.projects, parsed.query, (p) => [
        p.projectId,
        p.projectDisplayName,
        folderName(p.projectRootPath),
      ]);
      matches.sort(
        (a, b) =>
          a.projectDisplayName.localeCompare(b.projectDisplayName) ||
          a.projectId.localeCompare(b.projectId),
      );
      const page = pageText(
        matches,
        parsed,
        "/project",
        (p) =>
          `${literalText(p.projectDisplayName)} — ${p.projectId}\n   Folder: ${inlineCode(folderName(p.projectRootPath))}`,
      );
      return [
        "**Projects**",
        hostLine(this.deps.daemon, scope.target.daemonReference),
        "",
        page,
        "Select: /project <project-id>",
      ]
        .filter(Boolean)
        .join("\n");
    }
    const project = exactChoice(
      scope.projects,
      args.join(" "),
      (p) => p.projectId,
      (p) => p.projectDisplayName,
      "Project",
    );
    await this.save(scope, await this.authorize(scope, project));
    return this.acknowledgement(
      scope,
      `Selected Project: ${literalText(project.projectDisplayName)} (${project.projectId}). Workspace selection cleared.`,
    );
  }

  private selectedProject(scope: PlacementScope) {
    const { projects, chosen, base, target, context } = scope;
    const project = projects.find(
      (p) =>
        p.projectId === (chosen?.projectId ?? base.projectId) ||
        (!chosen && p.projectRootPath === base.cwd),
    );
    if (!project)
      throw new Error(
        "The selected Project is unavailable or you do not have access. Use /project to choose one.",
      );
    if (
      chosen &&
      (chosen.daemonReference !== target.daemonReference ||
        chosen.routePosition !== routePosition(context.account, context.route) ||
        chosen.routeFingerprint !== placementRouteFingerprint(context.route) ||
        chosen.projectRoot !== project.projectRootPath)
    )
      throw new Error("The selection expired after a Route or Host change. Select /project again.");
    return project;
  }

  private async branch(args: string[], scope: PlacementScope, project: ProjectSnapshot) {
    if (args[0] === "fetch") return this.fetch(args, scope, project);
    const parsed = discoveryArguments(args);
    if (parsed.worktree) throw new Error("--worktree only applies to /workspace list or search.");
    if (
      this.deps.daemon.getServerInfo()?.features?.["projectGitCommands"] !== true ||
      !this.deps.daemon.listGitBranches
    )
      throw new Error("Update this Host to support branch discovery.");
    const branches = search(
      await this.deps.daemon.listGitBranches(project.projectId),
      parsed.query,
      (b) => [b.name],
    );
    branches.sort((a, b) => b.committerDate - a.committerDate || a.name.localeCompare(b.name));
    return [
      "**Branches** — latest commit first",
      hostLine(this.deps.daemon, scope.target.daemonReference),
      projectLine(project),
      "",
      pageText(
        branches,
        parsed,
        "/branch",
        (b) => `${literalText(b.name)} — ${b.source}\n   ${commitLine(b.commit)}`,
      ),
      "Create: /workspace new <base-branch>",
      "Refresh remote refs: /branch fetch [remote] (default: origin)",
    ].join("\n");
  }

  private async createWorkspace(
    args: string[],
    scope: PlacementScope,
    project: ProjectSnapshot,
    value?: string,
  ) {
    const creation = creationArguments(args);
    const placement = await this.authorize(scope, project, undefined, false);
    const { context } = scope;
    const request = commandAccessRequest(
      this.deps.plane,
      context.message,
      context.account,
      context.route,
      "workspace.create",
      placementTarget(placement),
    );
    if (!(await this.deps.plane.commandAccess?.authorizeChannelPrivilege(request))?.allowed)
      throw new Error("Creating a Workspace needs workspace.create in the selected Project.");
    if (creation.kind === "worktree" && project.projectKind !== "git")
      throw new Error("This Project has no Git repository. Use /workspace new --local.");
    const operation = createHash("sha256")
      .update(JSON.stringify([scope.key, context.message.externalMessageId ?? randomUUID(), value]))
      .digest("hex");
    const created = await this.deps.daemon.createWorkspace(
      {
        cwd: project.projectRootPath,
        projectId: project.projectId,
        ...creation,
        idempotencyKey: `channel-workspace:${operation}`,
      },
      { source: context.message },
    );
    await this.save(scope, this.stamp(scope, project, created.workspaceId));
    return this.acknowledgement(
      scope,
      `Created and selected Workspace: ${literalText(creation.title ?? created.workspaceId)} (${created.workspaceId}). No Agent session has been created yet.`,
    );
  }

  private async workspace(args: string[], scope: PlacementScope, project: ProjectSnapshot) {
    if (!this.deps.daemon.listWorkspaces)
      throw new Error("Workspace discovery is unavailable on this Host.");
    const workspaces = (await this.deps.daemon.listWorkspaces(project.projectId)).filter(
      (w) => w.projectId === project.projectId,
    );
    const action = args[0];
    if (action === "list" || action === "search") {
      const parsed = discoveryArguments(args);
      const matches = search(
        workspaces.filter((w) => !parsed.worktree || w.workspaceKind === "worktree"),
        parsed.query,
        (w) => [w.id, w.name, w.branch ?? "", folderName(w.workspaceDirectory)],
      );
      matches.sort((a, b) => activity(b) - activity(a) || a.id.localeCompare(b.id));
      return [
        "**Workspaces** — latest activity first",
        hostLine(this.deps.daemon, scope.target.daemonReference),
        projectLine(project),
        "",
        pageText(matches, parsed, "/workspace", workspaceListLine),
        "Select: /workspace <workspace-id> · Branches: /branch",
      ]
        .filter(Boolean)
        .join("\n");
    }
    const workspace = exactChoice(
      workspaces,
      (action === "show" ? args.slice(1) : args).join(" "),
      (w) => w.id,
      (w) => w.name,
      "Workspace",
    );
    if (action === "show")
      return [
        hostLine(this.deps.daemon, scope.target.daemonReference),
        projectLine(project),
        ...workspaceDetails(workspace),
        `Select: /workspace ${workspace.id}`,
      ].join("\n");
    await this.save(scope, await this.authorize(scope, project, workspace));
    return this.acknowledgement(
      scope,
      `Selected Workspace: ${literalText(workspace.name)} (${workspace.id}) in ${literalText(project.projectDisplayName)}.`,
    );
  }

  private async projects(context: LifecycleCommandContext): Promise<ProjectSnapshot[]> {
    if (!this.deps.daemon.listProjects)
      throw new Error("Project discovery is unavailable on this Host.");
    const target = this.deps.plane.resolveAgentAccessTarget(
      context.route.target as Extract<typeof context.route.target, { kind: "agent" }>,
    );
    const projects = await this.deps.daemon.listProjects();
    const checks = await Promise.all(
      projects.map((p) =>
        this.deps.plane.commandAccess?.authorizeChannelPrivilege(
          commandAccessRequest(
            this.deps.plane,
            context.message,
            context.account,
            context.route,
            "project.use",
            { ...target, projectId: p.projectId, projectRoot: p.projectRootPath },
          ),
        ),
      ),
    );
    return projects.filter((_, i) => checks[i]?.allowed === true);
  }

  private async fetch(args: string[], scope: PlacementScope, project: ProjectSnapshot) {
    if (args.length > 2 || !this.deps.daemon.fetchGitRemote)
      throw new Error("Usage: /branch fetch [remote]");
    const request = commandAccessRequest(
      this.deps.plane,
      scope.context.message,
      scope.context.account,
      scope.context.route,
      "approval.command",
      placementTarget(this.stamp(scope, project)),
    );
    if (!(await this.deps.plane.commandAccess?.authorizeChannelPrivilege(request))?.allowed)
      throw new Error("Fetching remote refs needs approval.command in this Project.");
    const remote = args[1] ?? "origin";
    const fetchedAt = await this.deps.daemon.fetchGitRemote(
      project.projectId,
      remote,
      scope.context.message,
    );
    return [
      hostLine(this.deps.daemon, scope.target.daemonReference),
      projectLine(project),
      `Fetched ${inlineCode(remote)} at ${fetchedAt}.`,
      "Remote branch refs updated; working files and checked-out branch stay as they were.",
      "List: /branch list",
    ].join("\n");
  }

  private async worktree(args: string[], scope: PlacementScope) {
    const agent =
      !args.length && scope.context.agentId
        ? (await this.deps.daemon.listAgents()).find((a) => a.id === scope.context.agentId)
        : undefined;
    const currentProject = scope.projects.find((p) => p.projectId === agent?.projectId);
    if (agent && !currentProject)
      throw new Error("Current worktree unavailable or you do not have access.");
    const project = currentProject ?? this.selectedProject(scope);
    const workspaces = ((await this.deps.daemon.listWorkspaces?.(project.projectId)) ?? []).filter(
      (w) => w.projectId === project.projectId,
    );
    const workspaceId = scope.chosen ? scope.chosen.workspaceId : scope.base.workspaceId;
    const chosen = workspaces.find((w) => w.id === workspaceId);
    if (!args.length && !agent && workspaceId && !chosen)
      throw new Error("Selected Workspace is unavailable. Use /workspace to choose again.");
    return new ChannelWorktreeCommands(this.deps.daemon).run(args, {
      project,
      workspaces,
      hostReference: scope.target.daemonReference,
      defaultPath:
        agent?.projectId === project.projectId
          ? agent.cwd
          : (chosen?.workspaceDirectory ?? project.projectRootPath),
      currentWorkspaceId: agent?.workspaceId,
      selectedWorkspaceId: workspaceId,
      hasCurrentSession: agent !== undefined,
    });
  }

  private async status(scope: PlacementScope, gitInfo = false): Promise<string> {
    const { context, chosen } = scope;
    return placementStatus({
      daemon: this.deps.daemon,
      hostReference: scope.target.daemonReference,
      projects: scope.projects,
      agentId: context.agentId,
      base: scope.base,
      chosen,
      gitInfo,
      selectionValid:
        !chosen ||
        (chosen.daemonReference === scope.target.daemonReference &&
          chosen.routePosition === routePosition(context.account, context.route) &&
          chosen.routeFingerprint === placementRouteFingerprint(context.route)),
    });
  }
}

function creationArguments(args: string[]) {
  let local = false;
  let branchName: string | undefined;
  let title: string | undefined;
  let baseRef: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (token === "--local") local = true;
    else if (token === "--branch" || token === "--name") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${token} needs a value.`);
      if (token === "--branch") branchName = value;
      else title = value;
    } else if (token.startsWith("--") || baseRef)
      throw new Error(
        "Usage: /workspace new [base] [--branch name] [--name title] or /workspace new --local [--name title]",
      );
    else baseRef = token;
  }
  if (local && (baseRef || branchName))
    throw new Error("--local uses the Project's existing checkout; omit base and --branch.");
  return {
    kind: local ? ("directory" as const) : ("worktree" as const),
    ...(baseRef ? { baseRef } : {}),
    ...(branchName ? { branchName } : {}),
    ...(title ? { title } : {}),
  };
}
function exactChoice<T>(
  items: T[],
  query: string,
  id: (item: T) => string,
  name: (item: T) => string,
  label: string,
): T {
  const byId = items.find((item) => id(item) === query);
  if (byId) return byId;
  const matches = items.filter(
    (item) => name(item).toLocaleLowerCase() === query.toLocaleLowerCase(),
  );
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? `Several ${label}s share that name. Select by ID.`
        : `${label} is unavailable or you do not have access. Use list or search to find its ID.`,
    );
  return matches[0]!;
}
function activity(w: WorkspaceSnapshot): number {
  const date = Date.parse(w.activityAt ?? w.createdAt ?? "");
  return Number.isFinite(date) ? date : 0;
}
