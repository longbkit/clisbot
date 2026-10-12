import { createHash, randomUUID } from "node:crypto";
import type { ChannelStore } from "../db/channels.js";
import type { CreateAgentConfig, ProjectSnapshot, WorkspaceSnapshot } from "./daemon/types.js";
import type { DaemonConnection } from "./daemon/client.js";
import type { ChannelAgentAccessTarget, ChannelPlaneDeps } from "./plane/types.js";
import type { LifecycleCommandContext } from "./commands-lifecycle.js";
import { commandAccessRequest } from "./commands-context.js";
import { deriveBindingKey, routePosition } from "./bindings/index.js";
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
    command: { name: "project" | "workspace" | "branch"; value?: string },
    context: LifecycleCommandContext,
  ): Promise<string> {
    const scope = await this.prepare(context);
    const args = tokenizePlacementArguments(command.value ?? "");
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

  private acknowledgement(scope: PlacementScope, label: string) {
    const location = scope.key.externalThreadId === null ? "this conversation" : "this thread";
    return `${label}\nApplies to the next session in ${location}. The current session keeps its location. Use /new or /fork to start there.`;
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
    if (!action || action === "list" || action === "search") {
      const parsed = discoveryArguments(args);
      if (parsed.worktree) throw new Error("--worktree only applies to /workspace list or search.");
      const matches = search(scope.projects, parsed.query, (p) => [
        p.projectId,
        p.projectDisplayName,
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
        (p) => `${p.projectDisplayName} — ${p.projectId}`,
      );
      return [
        !action ? await this.status(scope) : undefined,
        `Projects on Host ${scope.target.daemonReference}`,
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
      `Selected Project: ${project.projectDisplayName} (${project.projectId}). Workspace selection cleared.`,
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

  private async branch(args: string[], _scope: PlacementScope, project: ProjectSnapshot) {
    const parsed = discoveryArguments(args);
    if (parsed.worktree) throw new Error("--worktree only applies to /workspace list or search.");
    if (!this.deps.daemon.listBranches)
      throw new Error("Branch discovery is unavailable on this Host.");
    const branches = search(
      await this.deps.daemon.listBranches(project.projectRootPath),
      parsed.query,
      (b) => [b.name, ...(b.hasRemote ? [`origin/${b.name}`] : [])],
    );
    branches.sort((a, b) => b.committerDate - a.committerDate || a.name.localeCompare(b.name));
    return [
      `Branches in ${project.projectDisplayName}`,
      pageText(
        branches,
        parsed,
        "/branch",
        (b) =>
          `${b.name} — ${[b.hasLocal && "local", b.hasRemote && "origin"].filter(Boolean).join(", ")}`,
      ),
      "Create: /workspace new <base-branch>",
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
      `Created and selected Workspace: ${creation.title ?? created.workspaceId} (${created.workspaceId}). No Agent session has been created yet.`,
    );
  }

  private async workspace(args: string[], scope: PlacementScope, project: ProjectSnapshot) {
    if (!this.deps.daemon.listWorkspaces)
      throw new Error("Workspace discovery is unavailable on this Host.");
    const workspaces = (await this.deps.daemon.listWorkspaces(project.projectId)).filter(
      (w) => w.projectId === project.projectId,
    );
    const action = args[0];
    if (!action || action === "list" || action === "search") {
      const parsed = discoveryArguments(args);
      const matches = search(
        workspaces.filter((w) => !parsed.worktree || w.workspaceKind === "worktree"),
        parsed.query,
        (w) => [w.id, w.name, w.branch ?? ""],
      );
      matches.sort((a, b) => activity(b) - activity(a) || a.id.localeCompare(b.id));
      return [
        !action ? await this.status(scope) : undefined,
        `Workspaces in ${project.projectDisplayName} — latest activity first`,
        pageText(matches, parsed, "/workspace", workspaceLine),
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
        `Workspace: ${workspace.name} (${workspace.id})`,
        `Project: ${project.projectDisplayName} (${project.projectId})`,
        `Directory: ${workspace.workspaceDirectory}`,
        `Kind: ${workspace.workspaceKind}`,
        `Branch: ${workspace.branch ?? "none"}`,
        `Last activity: ${workspace.activityAt ?? workspace.createdAt ?? "unknown"}`,
        `Select: /workspace ${workspace.id}`,
      ].join("\n");
    await this.save(scope, await this.authorize(scope, project, workspace));
    return this.acknowledgement(
      scope,
      `Selected Workspace: ${workspace.name} (${workspace.id}) in ${project.projectDisplayName}.`,
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

  private async status(scope: PlacementScope): Promise<string> {
    const { context, chosen, projects } = scope;
    const agent = context.agentId
      ? (await this.deps.daemon.listAgents()).find((a) => a.id === context.agentId)
      : undefined;
    const visible = new Set(projects.map((p) => p.projectId));
    let current = "none";
    if (agent)
      current = visible.has(agent.projectId ?? "")
        ? `${agent.projectId} / ${agent.workspaceId ?? agent.cwd}`
        : "location unavailable";
    let next = "Route default";
    if (chosen)
      next = visible.has(chosen.projectId)
        ? `${chosen.projectId} / ${chosen.workspaceId ?? "new Workspace"}`
        : "location unavailable";
    return [`Current session: ${current}`, `Next session: ${next}`].join("\n");
  }
}

function workspaceLine(w: WorkspaceSnapshot) {
  return `${w.name} — ${w.id} · ${w.workspaceKind === "worktree" ? "worktree" : "local"}${w.branch ? ` · ${w.branch}` : ""} · ${w.activityAt ?? w.createdAt ?? "no activity"}`;
}

interface DiscoveryArguments {
  query: string;
  page: number;
  worktree: boolean;
}
function discoveryArguments(args: string[]): DiscoveryArguments {
  const tokens = [...args];
  const action = tokens.shift() ?? "list";
  if (action !== "list" && action !== "search")
    throw new Error("Usage: list or search <text> [--page N]");
  let page = 1;
  let worktree = false;
  const words: string[] = [];
  while (tokens.length) {
    const token = tokens.shift()!;
    if (token === "--page") {
      const number = tokens.shift();
      if (!number || !/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number)))
        throw new Error("--page must be a positive integer.");
      page = Number(number);
    } else if (token === "--worktree") worktree = true;
    else if (token.startsWith("--")) throw new Error(`Unknown option: ${token}`);
    else words.push(token);
  }
  if ((action === "search" && words.length === 0) || (action === "list" && words.length > 0))
    throw new Error("Usage: list [--page N] or search <text> [--page N]");
  return { query: words.join(" "), page, worktree };
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
export function tokenizePlacementArguments(text: string): string[] {
  const result: string[] = [];
  let word = "";
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\\" && i + 1 < text.length && /["'\\]/.test(text[i + 1]!)) word += text[++i];
    else if (quote) {
      if (c === quote) quote = undefined;
      else word += c;
    } else if (c === '"' || c === "'") quote = c;
    else if (/\s/.test(c)) {
      if (word) {
        result.push(word);
        word = "";
      }
    } else word += c;
  }
  if (quote) throw new Error("Close the quoted argument before sending this command.");
  if (word) result.push(word);
  return result;
}
function search<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) =>
    terms.every((term) => fields(item).some((field) => field.toLocaleLowerCase().includes(term))),
  );
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
function pageText<T>(
  items: T[],
  args: DiscoveryArguments,
  command: string,
  line: (item: T) => string,
): string {
  const pages = Math.max(1, Math.ceil(items.length / 10));
  if (args.page > pages)
    throw new Error(`Page ${args.page} is unavailable. There are ${pages} page(s).`);
  const start = (args.page - 1) * 10;
  const prefix = `${command} ${args.query ? `search ${JSON.stringify(args.query)}` : "list"}${args.worktree ? " --worktree" : ""}`;
  return [
    `Page ${args.page}/${pages} · ${items.length} results · up to 10 per page`,
    ...(items.length
      ? items.slice(start, start + 10).map((item, i) => `${start + i + 1}. ${line(item)}`)
      : ["No matches."]),
    ...(args.page > 1 ? [`Previous: ${prefix} --page ${args.page - 1}`] : []),
    ...(args.page < pages ? [`Next: ${prefix} --page ${args.page + 1}`] : []),
  ].join("\n");
}
