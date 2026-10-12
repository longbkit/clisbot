import type { GitWorktreeSummary, GitWorktreeInspection } from "@clisbot/protocol/messages";
import type { DaemonConnection } from "./daemon/client.js";
import type { ProjectSnapshot, WorkspaceSnapshot } from "./daemon/types.js";
import { discoveryArguments, search, pageText } from "./commands-discovery.js";
import { folderName, hostLine, projectLine } from "./commands-placement-display.js";
import { commitLine, gitStatusLine } from "./commands-git-display.js";
import { inlineCode, literalText } from "./command-reply-format.js";

function samePath(a: string, b: string): boolean {
  const normalize = (p: string) => p.replace(/\\/gu, "/").replace(/\/+$/u, "");
  return normalize(a) === normalize(b);
}
function related(tree: GitWorktreeSummary, workspaces: WorkspaceSnapshot[]) {
  return workspaces.filter((w) => samePath(w.workspaceDirectory, tree.path));
}
function workspaceLine(workspace: WorkspaceSnapshot): string {
  return `Workspace: ${literalText(workspace.name)} (${workspace.id})`;
}
function registeredWorkspaceLine(tree: GitWorktreeSummary, workspaces: WorkspaceSnapshot[]) {
  const matches = related(tree, workspaces);
  if (matches.length === 1) return workspaceLine(matches[0]!);
  if (!matches.length) return "Workspace: not registered";
  return `Workspaces: ${matches.length} registered here; use /workspace list.`;
}
function treeDetails(
  tree: GitWorktreeSummary,
  primaryPath: string,
  workspace: string,
  inspection?: GitWorktreeInspection,
): string[] {
  const branchFallback = tree.detached ? "detached HEAD" : "none";
  const kind = samePath(tree.path, primaryPath) ? "local (Project root)" : "worktree";
  return [
    workspace,
    `Kind: ${tree.bare ? "bare repository" : kind}`,
    `Path: ${inlineCode(tree.path)}`,
    `Branch: ${tree.branch ? inlineCode(tree.branch) : branchFallback}`,
    tree.bare ? "Status: bare repository" : gitStatusLine(inspection),
    commitLine(inspection?.commit ?? tree.commit),
    ...[tree.locked && "Locked", tree.prunable && "Prunable"]
      .filter(Boolean)
      .map((label) => `${label}: yes`),
  ];
}

interface WorktreeCommandInput {
  project: ProjectSnapshot;
  workspaces: WorkspaceSnapshot[];
  hostReference: string;
  defaultPath: string;
  hasCurrentSession: boolean;
  currentWorkspaceId?: string | undefined;
  selectedWorkspaceId?: string | undefined;
}

export class ChannelWorktreeCommands {
  constructor(private readonly daemon: DaemonConnection) {}
  async run(args: string[], input: WorktreeCommandInput): Promise<string> {
    const { project } = input;
    if (
      this.daemon.getServerInfo()?.features?.["projectGitCommands"] !== true ||
      !this.daemon.listGitWorktrees
    )
      throw new Error("Update this Host to support /worktree.");
    if (project.projectKind !== "git") throw new Error("This Project has no Git worktrees.");
    const trees = await this.daemon.listGitWorktrees(project.projectId);
    const header = [
      args[0] === "list" || args[0] === "search" ? "**Git worktrees**" : "**Git worktree**",
      hostLine(this.daemon, input.hostReference),
      projectLine(project),
      "",
    ];
    if (args[0] === "list" || args[0] === "search") return this.list(args, input, trees, header);
    return this.show(args, input, trees, header);
  }

  private async show(
    args: string[],
    input: WorktreeCommandInput,
    trees: GitWorktreeSummary[],
    header: string[],
  ): Promise<string> {
    const { project, workspaces } = input;
    if (args.length && args[0] !== "show")
      throw new Error("Usage: /worktree [list|search <text>|show <path-or-workspace-id>]");
    const query = args.length ? args.slice(1).join(" ") : input.defaultPath;
    if (!query) throw new Error("Usage: /worktree show <path-or-workspace-id>");
    let workspaceId = query;
    if (!args.length)
      workspaceId =
        (input.hasCurrentSession ? input.currentWorkspaceId : input.selectedWorkspaceId) ?? "";
    const workspace = workspaces.find(
      (w) =>
        w.id === workspaceId && (args.length || samePath(w.workspaceDirectory, input.defaultPath)),
    );
    const tree = trees.find((t) => samePath(t.path, workspace?.workspaceDirectory ?? query));
    if (!tree) throw new Error("Worktree is unavailable in this Project. Use /worktree list.");
    const info = await this.inspect(project.projectId, tree);
    const context: string[] = [];
    let label = registeredWorkspaceLine(tree, workspaces);
    if (!args.length) {
      context.push("**Current session**");
      if (!input.hasCurrentSession)
        context.push(
          "None.",
          "",
          input.selectedWorkspaceId ? "**Next session**" : "**Project root**",
        );
      label = input.hasCurrentSession ? "Workspace: name unavailable" : "Workspace: not selected";
      if (workspaceId) label = `Workspace: name unavailable (${workspaceId})`;
    }
    if (workspace) label = workspaceLine(workspace);
    return [
      ...header,
      ...context,
      ...treeDetails(tree, trees[0]?.path ?? project.projectRootPath, label, info),
      ...(info?.commit ? [`Subject: ${literalText(info.commit.subject)}`] : []),
      "",
      "List: /worktree list · Search: /worktree search <text>",
    ].join("\n");
  }

  private async inspect(projectId: string, tree: GitWorktreeSummary) {
    if (tree.bare || !this.daemon.inspectGitWorktree) return undefined;
    try {
      return await this.daemon.inspectGitWorktree(projectId, tree.path);
    } catch {
      return undefined;
    }
  }

  private async list(
    args: string[],
    input: { project: ProjectSnapshot; workspaces: WorkspaceSnapshot[] },
    trees: GitWorktreeSummary[],
    header: string[],
  ) {
    const parsed = discoveryArguments(args);
    if (parsed.worktree) throw new Error("/worktree already lists Git worktrees; omit --worktree.");
    const matches = search(trees, parsed.query, (tree) => [
      folderName(tree.path),
      tree.branch ?? "",
      ...related(tree, input.workspaces).flatMap((w) => [w.name, w.id]),
    ]);
    matches.sort(
      (a, b) =>
        Date.parse(b.commit?.committedAt ?? "1970-01-01") -
          Date.parse(a.commit?.committedAt ?? "1970-01-01") || a.path.localeCompare(b.path),
    );
    pageText(matches, parsed, "/worktree", () => "");
    const start = (parsed.page - 1) * 10;
    const inspections = await Promise.all(
      matches.slice(start, start + 10).map((tree) => this.inspect(input.project.projectId, tree)),
    );
    const details = new Map(
      matches.slice(start, start + 10).map((tree, i) => [tree.path, inspections[i]]),
    );
    return [
      ...header,
      "Latest commit first",
      pageText(matches, parsed, "/worktree", (tree) =>
        [
          literalText(folderName(tree.path)),
          ...treeDetails(
            tree,
            trees[0]?.path ?? input.project.projectRootPath,
            registeredWorkspaceLine(tree, input.workspaces),
            details.get(tree.path),
          ).map((line) => `   ${line}`),
        ].join("\n"),
      ),
      "",
      "Inspect: /worktree show <path-or-workspace-id> · Create/select: /workspace",
    ].join("\n");
  }
}
