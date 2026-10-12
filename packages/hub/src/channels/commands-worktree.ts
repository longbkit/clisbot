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
function treeDetails(
  tree: GitWorktreeSummary,
  workspaces: WorkspaceSnapshot[],
  inspection?: GitWorktreeInspection,
): string[] {
  const workspace = related(tree, workspaces)[0];
  const branchFallback = tree.detached ? "detached HEAD" : "none";
  return [
    `Workspace: ${workspace ? `${literalText(workspace.name)} (${workspace.id})` : "not registered"}`,
    `Path: ${inlineCode(tree.path)}`,
    `Branch: ${tree.branch ? inlineCode(tree.branch) : branchFallback}`,
    tree.bare ? "Status: bare repository" : gitStatusLine(inspection),
    commitLine(inspection?.commit ?? tree.commit),
    ...[tree.locked && "Locked", tree.prunable && "Prunable"]
      .filter(Boolean)
      .map((label) => `${label}: yes`),
  ];
}

export class ChannelWorktreeCommands {
  constructor(private readonly daemon: DaemonConnection) {}
  async run(
    args: string[],
    input: {
      project: ProjectSnapshot;
      workspaces: WorkspaceSnapshot[];
      hostReference: string;
      defaultPath: string;
      currentWorkspaceId?: string | undefined;
    },
  ): Promise<string> {
    const { project, workspaces } = input;
    if (
      this.daemon.getServerInfo()?.features?.["projectGitCommands"] !== true ||
      !this.daemon.listGitWorktrees
    )
      throw new Error("Update this Host to support /worktree.");
    if (project.projectKind !== "git") throw new Error("This Project has no Git worktrees.");
    const trees = await this.daemon.listGitWorktrees(project.projectId);
    const header = [
      "**Git worktrees**",
      hostLine(this.daemon, input.hostReference),
      projectLine(project),
      "",
    ];
    if (args[0] === "list" || args[0] === "search") return this.list(args, input, trees, header);
    if (args.length && args[0] !== "show")
      throw new Error("Usage: /worktree [list|search <text>|show <path-or-workspace-id>]");
    const query = args.length ? args.slice(1).join(" ") : input.defaultPath;
    if (!query) throw new Error("Usage: /worktree show <path-or-workspace-id>");
    const workspace = workspaces.find(
      (w) => w.id === query || (!args.length && w.id === input.currentWorkspaceId),
    );
    const tree = trees.find((t) => samePath(t.path, workspace?.workspaceDirectory ?? query));
    if (!tree) throw new Error("Worktree is unavailable in this Project. Use /worktree list.");
    const info = await this.inspect(project.projectId, tree);
    const ordered = workspace
      ? [workspace, ...workspaces.filter((w) => w.id !== workspace.id)]
      : workspaces;
    return [
      ...header,
      ...treeDetails(tree, ordered, info),
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
          literalText(related(tree, input.workspaces)[0]?.name ?? folderName(tree.path)),
          ...treeDetails(tree, input.workspaces, details.get(tree.path)).map(
            (line) => `   ${line}`,
          ),
        ].join("\n"),
      ),
      "",
      "Inspect: /worktree show <path-or-workspace-id> · Create/select: /workspace",
    ].join("\n");
  }
}
