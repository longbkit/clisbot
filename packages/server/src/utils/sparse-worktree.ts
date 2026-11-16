import { isAbsolute, posix } from "node:path";

import { runGitCommand } from "./run-git-command.js";

/**
 * A sparse worktree checks out only the listed directories and files, plus the root files
 * unless the caller opts out. Large monorepos use it so a ticket's workspace holds only the
 * parts it touches. Without a sparse request a worktree is a full checkout, as before.
 *
 * Git accepts any path on a worktree that has no files yet, so a typo would leave the agent
 * in a near-empty checkout. Every path is therefore checked against the start point before
 * `git worktree add` runs, which keeps a refused request from leaving a branch behind.
 */

export interface SparseCheckoutRequest {
  /** Repo-relative directories or files. */
  paths: readonly string[];
  /** Also check out the files directly in the repository root. Defaults to true. */
  includeRootFiles?: boolean;
}

export interface NormalizedSparseCheckout {
  paths: string[];
  includeRootFiles: boolean;
}

/**
 * Cone mode is git's fast path and only takes directories plus the root files; any file
 * path, or leaving the root files out, needs gitignore-style patterns instead.
 */
export type SparseCheckoutPlan =
  | { mode: "cone"; directories: string[] }
  | { mode: "patterns"; patterns: string[] };

export class SparsePathError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(message);
    this.name = "SparsePathError";
    this.path = path;
  }
}

/** Returns repo-relative POSIX paths, without duplicates, or throws on an unsafe path. */
export function normalizeSparseCheckout(request: SparseCheckoutRequest): NormalizedSparseCheckout {
  if (request.paths.length === 0) {
    throw new SparsePathError("Sparse checkout needs at least one path", "");
  }
  return {
    paths: [...new Set(request.paths.map(normalizeSparsePath))],
    includeRootFiles: request.includeRootFiles ?? true,
  };
}

function normalizeSparsePath(rawPath: string): string {
  const path = rawPath.trim().replaceAll("\\", "/");
  if (path === "" || path === "." || path === "./") {
    throw new SparsePathError("Sparse path is empty", rawPath);
  }
  if (isAbsolute(path) || posix.isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
    throw new SparsePathError(`Sparse path must be relative to the checkout: ${rawPath}`, rawPath);
  }
  const relative = posix.normalize(path).replace(/\/+$/, "");
  if (relative === "." || relative === ".." || relative.startsWith("../")) {
    throw new SparsePathError(`Sparse path escapes the checkout: ${rawPath}`, rawPath);
  }
  return relative;
}

/** `git worktree add <path> [args...]` always takes the commit-ish as its last argument. */
export function worktreeStartPoint(addArguments: readonly string[]): string {
  const startPoint = addArguments.at(-1);
  if (!startPoint) {
    throw new Error("git worktree add needs a start point for a sparse checkout");
  }
  return startPoint;
}

/** Checks each path at the start point and picks cone mode when it can express the request. */
export async function planSparseCheckout(input: {
  cwd: string;
  startPoint: string;
  sparse: NormalizedSparseCheckout;
}): Promise<SparseCheckoutPlan> {
  const directories: string[] = [];
  const files: string[] = [];
  for (const path of input.sparse.paths) {
    const objectType = await readObjectType(input.cwd, `${input.startPoint}:${path}`);
    if (objectType === "tree") directories.push(path);
    else if (objectType === "blob") files.push(path);
    else {
      throw new SparsePathError(`Sparse path does not exist in ${input.startPoint}: ${path}`, path);
    }
  }

  if (files.length === 0 && input.sparse.includeRootFiles) {
    return { mode: "cone", directories };
  }
  return {
    mode: "patterns",
    patterns: [
      // The same root-files rule cone mode applies: every file at the top, no directory.
      ...(input.sparse.includeRootFiles ? ["/*", "!/*/"] : []),
      ...directories.map((directory) => `/${escapeSparsePattern(directory)}/`),
      ...files.map((file) => `/${escapeSparsePattern(file)}`),
    ],
  };
}

function escapeSparsePattern(path: string): string {
  return path.replace(/[\\*?[\]]/g, "\\$&");
}

async function readObjectType(cwd: string, objectName: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["cat-file", "-t", objectName], {
      cwd,
      timeout: 30_000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Fills a worktree created with `--no-checkout`: limit it to the plan, then check out HEAD.
 * A failure removes the half-made worktree; a branch the add created stays, as on other failures.
 */
export async function checkOutSparseWorktree(input: {
  repoCwd: string;
  worktreePath: string;
  plan: SparseCheckoutPlan;
}): Promise<void> {
  const setArguments =
    input.plan.mode === "cone"
      ? ["--cone", "--", ...input.plan.directories]
      : ["--no-cone", "--", ...input.plan.patterns];
  try {
    await runGitCommand(["sparse-checkout", "set", ...setArguments], {
      cwd: input.worktreePath,
      timeout: 120_000,
    });
    await runGitCommand(["checkout"], { cwd: input.worktreePath, timeout: 120_000 });
  } catch (error) {
    await runGitCommand(["worktree", "remove", "--force", input.worktreePath], {
      cwd: input.repoCwd,
      timeout: 120_000,
    }).catch(() => undefined);
    throw error;
  }
}

/** A workspace opened in a subdirectory needs that directory in the checkout too. */
export function withWorkspaceDirectory(
  sparse: SparseCheckoutRequest | undefined,
  relativeWorkspaceCwd: string,
): SparseCheckoutRequest | undefined {
  if (!sparse || relativeWorkspaceCwd === "" || relativeWorkspaceCwd === ".") {
    return sparse;
  }
  return { ...sparse, paths: [...sparse.paths, relativeWorkspaceCwd] };
}
