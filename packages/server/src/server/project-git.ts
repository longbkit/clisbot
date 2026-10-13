import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitWorktreeInspection,
  GitWorktreeSummary,
} from "@clisbot/protocol/messages";
import { parseWorktreeList } from "../utils/checkout-git.js";
import { runGitCommand } from "../utils/run-git-command.js";

const READ_ONLY = { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
async function git(cwd: string, args: string[]) {
  return runGitCommand(args, { cwd, envOverlay: READ_ONLY, timeout: 15_000 });
}
function commit(fields: string[]): GitCommitSummary | null {
  const [hash, committedAt, author, subject] = fields;
  return hash && committedAt && author !== undefined
    ? { hash, committedAt, author, subject: subject ?? "" }
    : null;
}
async function latestCommit(cwd: string, ref: string): Promise<GitCommitSummary | null> {
  const result = await runGitCommand(["log", "-1", "--format=%H%x00%cI%x00%an%x00%s", ref, "--"], {
    cwd,
    envOverlay: READ_ONLY,
    acceptExitCodes: [0, 128],
    timeout: 15_000,
  });
  return result.exitCode === 0 ? commit(result.stdout.trimEnd().split("\0")) : null;
}
export async function listProjectGitBranches(cwd: string): Promise<GitBranchSummary[]> {
  const { stdout } = await git(cwd, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)%00%(authorname)%00%(subject)%00%(symref)",
    "refs/heads",
    "refs/remotes",
  ]);
  return stdout.split("\n").flatMap((row) => {
    const [ref, hash, date, author, subject, symbolic] = row.split("\0");
    if (!ref || symbolic) return [];
    const info = commit([hash ?? "", date ?? "", author ?? "", subject ?? ""]);
    if (!info) return [];
    const local = ref.startsWith("refs/heads/");
    const name = ref.slice(local ? 11 : 13);
    return [
      {
        name,
        source: local ? ("local" as const) : ("remote" as const),
        ...(!local ? { remote: name.split("/")[0]! } : {}),
        commit: info,
      },
    ];
  });
}
export async function listProjectGitWorktrees(cwd: string): Promise<GitWorktreeSummary[]> {
  const { stdout } = await git(cwd, ["worktree", "list", "--porcelain", "-z"]);
  const commits = new Map<string, Promise<GitCommitSummary | null>>(
    (await listProjectGitBranches(cwd)).map((b) => [b.commit.hash, Promise.resolve(b.commit)]),
  );
  return Promise.all(
    parseWorktreeList(stdout).map(async (entry) => {
      if (entry.head && /^[a-f0-9]{40,64}$/u.test(entry.head) && !commits.has(entry.head))
        commits.set(entry.head, latestCommit(cwd, entry.head));
      const tree: GitWorktreeSummary = {
        path: entry.path,
        bare: entry.isBare === true,
        detached: entry.detached === true,
        locked: entry.locked === true,
        prunable: entry.prunable === true,
        commit: entry.head ? ((await commits.get(entry.head)) ?? null) : null,
      };
      if (entry.branchRef) tree.branch = entry.branchRef.replace(/^refs\/heads\//u, "");
      if (entry.head) tree.head = entry.head;
      return tree;
    }),
  );
}
export function countGitStatus(output: string): NonNullable<GitWorktreeInspection["status"]> {
  const counts = { tracked: 0, untracked: 0, staged: 0, unstaged: 0, conflicts: 0 };
  const records = output.split("\0");
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    if (!row) continue;
    const code = row.slice(0, 2);
    if (code === "??") {
      counts.untracked++;
      continue;
    }
    if (code === "!!") continue;
    counts.tracked++;
    if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(code)) counts.conflicts++;
    else {
      if (code[0] !== " ") counts.staged++;
      if (code[1] !== " ") counts.unstaged++;
    }
    if (/[RC]/u.test(code)) i++;
  }
  return counts;
}
async function commonDirectory(cwd: string) {
  const { stdout } = await git(cwd, ["rev-parse", "--git-common-dir"]);
  return realpath(resolve(cwd, stdout.trim()));
}
export async function inspectProjectGitWorktree(
  cwd: string,
  path: string,
): Promise<GitWorktreeInspection> {
  const { stdout } = await git(cwd, ["worktree", "list", "--porcelain", "-z"]);
  const entry = parseWorktreeList(stdout).find(
    (w) => !w.isBare && resolve(w.path) === resolve(path),
  );
  if (!entry) throw new Error("The path is not a worktree of this Project.");
  const candidate = await realpath(entry.path);
  if ((await commonDirectory(cwd)) !== (await commonDirectory(candidate)))
    throw new Error("The path is not a worktree of this Project.");
  const [status, latest] = await Promise.all([
    git(candidate, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    latestCommit(candidate, "HEAD"),
  ]);
  return { path: candidate, status: countGitStatus(status.stdout), commit: latest };
}
export async function fetchProjectGitRemote(cwd: string, remote: string): Promise<string> {
  const { stdout } = await git(cwd, ["remote"]);
  if (remote.startsWith("-") || !stdout.split("\n").includes(remote))
    throw new Error("Choose a remote configured in this Project.");
  try {
    await runGitCommand(
      [
        "fetch",
        "--no-prune",
        "--no-tags",
        "--no-recurse-submodules",
        "--no-write-fetch-head",
        "--refmap=",
        "--",
        remote,
        `+refs/heads/*:refs/remotes/${remote}/*`,
      ],
      {
        cwd,
        envOverlay: { GIT_TERMINAL_PROMPT: "0" },
        timeout: 30_000,
      },
    );
  } catch (cause) {
    throw new Error("Fetch failed. Check this Host's Git credentials and network.", { cause });
  }
  return new Date().toISOString();
}
