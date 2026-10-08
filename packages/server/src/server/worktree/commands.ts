import { join } from "node:path";

import { getClisbotWorktreesRoot, isClisbotOwnedWorktreeCwd } from "../../utils/worktree.js";
import {
  archiveByScope,
  resolveWorkspaceIdAtPath,
  type ArchiveDependencies,
  type ArchiveScope,
} from "../workspace-archive-service.js";
import type {
  CreateClisbotWorktreeInput,
  CreateClisbotWorktreeResult,
} from "../clisbot-worktree-service.js";
import { toWorktreeWireError, type WorktreeWireError } from "../worktree-errors.js";
import type { WorkspaceGitService, WorkspaceGitWorktreeInfo } from "../workspace-git-service.js";

export interface ListClisbotWorktreesCommandDependencies {
  workspaceGitService: Pick<WorkspaceGitService, "listWorktrees">;
}

export interface ListClisbotWorktreesCommandInput {
  cwd: string;
  reason?: string;
}

export async function listClisbotWorktreesCommand(
  dependencies: ListClisbotWorktreesCommandDependencies,
  input: ListClisbotWorktreesCommandInput,
): Promise<WorkspaceGitWorktreeInfo[]> {
  if (input.reason) {
    return dependencies.workspaceGitService.listWorktrees(input.cwd, { reason: input.reason });
  }
  return dependencies.workspaceGitService.listWorktrees(input.cwd);
}

type CreateClisbotWorktreeWorkflow<Result extends CreateClisbotWorktreeResult> = (
  input: CreateClisbotWorktreeInput,
) => Promise<Result>;

export interface CreateClisbotWorktreeCommandDependencies<
  Result extends CreateClisbotWorktreeResult = CreateClisbotWorktreeResult,
> {
  clisbotHome?: string;
  worktreesRoot?: string;
  createClisbotWorktreeWorkflow?: CreateClisbotWorktreeWorkflow<Result>;
}

export type CreateClisbotWorktreeCommandInput = Omit<
  CreateClisbotWorktreeInput,
  "clisbotHome" | "runSetup"
> & {
  clisbotHome?: string;
  worktreesRoot?: string;
};

export type CreateClisbotWorktreeCommandResult<Result extends CreateClisbotWorktreeResult> =
  | {
      ok: true;
      createdWorktree: Result;
    }
  | {
      ok: false;
      error: WorktreeWireError;
      cause: unknown;
    };

export async function createClisbotWorktreeCommand<Result extends CreateClisbotWorktreeResult>(
  dependencies: CreateClisbotWorktreeCommandDependencies<Result>,
  input: CreateClisbotWorktreeCommandInput,
): Promise<CreateClisbotWorktreeCommandResult<Result>> {
  try {
    if (!dependencies.createClisbotWorktreeWorkflow) {
      throw new Error("Clisbot worktree service is not configured");
    }

    const createdWorktree = await dependencies.createClisbotWorktreeWorkflow({
      ...input,
      runSetup: false,
      clisbotHome: input.clisbotHome ?? dependencies.clisbotHome,
      worktreesRoot: input.worktreesRoot ?? dependencies.worktreesRoot,
    });
    return { ok: true, createdWorktree };
  } catch (error) {
    return {
      ok: false,
      error: toWorktreeWireError(error),
      cause: error,
    };
  }
}

export interface ArchiveCommandDependencies extends Omit<
  ArchiveDependencies,
  "workspaceGitService"
> {
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot" | "listWorktrees">;
}

export interface ArchiveCommandInput {
  requestId: string;
  repoRoot?: string | null;
  worktreePath?: string;
  worktreeSlug?: string;
  branchName?: string;
  workspaceId?: string;
  scope?: ArchiveScope["kind"];
}

export type ArchiveCommandResult =
  | {
      ok: true;
      removedAgents: string[];
    }
  | {
      ok: false;
      code: "NOT_ALLOWED";
      message: string;
      removedAgents: [];
    };

export async function archiveCommand(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<ArchiveCommandResult> {
  const targetPath = await resolveArchiveTarget(dependencies, input);
  const scope = input.scope ?? "workspace";
  const ownership = await isClisbotOwnedWorktreeCwd(targetPath, {
    clisbotHome: dependencies.clisbotHome,
    worktreesRoot: dependencies.clisbotWorktreesBaseRoot,
  });

  if (scope === "worktree") {
    if (!ownership.allowed) {
      return {
        ok: false,
        code: "NOT_ALLOWED",
        message: "Worktree is not a Clisbot-owned worktree",
        removedAgents: [],
      };
    }

    const result = await archiveByScope(dependencies, {
      scope: { kind: "worktree", targetPath },
      requestId: input.requestId,
    });

    return {
      ok: true,
      removedAgents: result.archivedAgentIds,
    };
  }

  const workspaceId =
    input.workspaceId ?? (await resolveWorkspaceIdAtPath(dependencies, targetPath));

  if (!workspaceId) {
    dependencies.sessionLogger?.warn(
      { targetPath },
      "Could not resolve workspace for archive; skipping",
    );
    return {
      ok: true,
      removedAgents: [],
    };
  }

  const result = await archiveByScope(dependencies, {
    scope: { kind: "workspace", workspaceId },
    requestId: input.requestId,
  });

  return {
    ok: true,
    removedAgents: result.archivedAgentIds,
  };
}

async function resolveArchiveTarget(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<string> {
  const repoRoot = input.repoRoot ?? null;
  if (input.worktreePath) {
    return input.worktreePath;
  }

  if (input.worktreeSlug) {
    if (!repoRoot) {
      throw new Error("repoRoot is required when worktreeSlug is supplied");
    }
    return resolveWorktreeSlugPath(dependencies, repoRoot, input.worktreeSlug);
  }

  if (repoRoot && input.branchName) {
    const worktrees = await dependencies.workspaceGitService.listWorktrees(repoRoot);
    const match = worktrees.find((entry) => entry.branchName === input.branchName);
    if (!match) {
      throw new Error(`Clisbot worktree not found for branch ${input.branchName}`);
    }
    return match.path;
  }

  throw new Error("worktreePath, worktreeSlug, or repoRoot+branchName is required");
}

async function resolveWorktreeSlugPath(
  dependencies: ArchiveCommandDependencies,
  repoRoot: string,
  worktreeSlug: string,
): Promise<string> {
  const worktreesRoot = await getClisbotWorktreesRoot(
    repoRoot,
    dependencies.clisbotHome,
    dependencies.clisbotWorktreesBaseRoot,
  );
  return join(worktreesRoot, worktreeSlug);
}
