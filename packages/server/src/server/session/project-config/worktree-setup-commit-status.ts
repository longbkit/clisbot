import {
  ClisbotConfigRawSchema,
  normalizeLifecycleCommands,
  type ClisbotConfigRaw,
} from "@clisbot/protocol/clisbot-config-schema";
import { READ_ONLY_GIT_ENV } from "../../checkout-git-utils.js";
import { runGitCommand } from "../../../utils/run-git-command.js";

export async function hasUncommittedWorktreeSetupChanges(input: {
  repoRoot: string;
  currentConfig: ClisbotConfigRaw | null;
}): Promise<boolean> {
  const gitPath = await resolveConfigGitPath(input.repoRoot);
  const committedConfig = await readCommittedConfig(input.repoRoot, gitPath);
  const currentSetup = normalizeLifecycleCommands(input.currentConfig?.worktree?.setup);
  const committedSetup = normalizeLifecycleCommands(committedConfig?.worktree?.setup);
  return !stringArraysEqual(currentSetup, committedSetup);
}

async function resolveConfigGitPath(repoRoot: string): Promise<string> {
  const { stdout } = await runGitCommand(["rev-parse", "--show-prefix"], {
    cwd: repoRoot,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  return `${stdout.trim()}clisbot.json`;
}

async function readCommittedConfig(
  repoRoot: string,
  gitPath: string,
): Promise<ClisbotConfigRaw | null> {
  await runGitCommand(["rev-parse", "--verify", "HEAD"], {
    cwd: repoRoot,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  const { stdout: trackedPath } = await runGitCommand(
    ["ls-tree", "--name-only", "HEAD", "--", gitPath],
    {
      cwd: repoRoot,
      envOverlay: READ_ONLY_GIT_ENV,
    },
  );
  if (trackedPath.trim().length === 0) return null;

  const { stdout } = await runGitCommand(["show", `HEAD:${gitPath}`], {
    cwd: repoRoot,
    envOverlay: READ_ONLY_GIT_ENV,
  });
  return ClisbotConfigRawSchema.parse(JSON.parse(stdout));
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
