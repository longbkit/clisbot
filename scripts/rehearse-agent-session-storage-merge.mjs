/** Snapshot dirty source into a new detached worktree and perform an actual upstream merge. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}
const root = path.resolve(option("root", process.cwd()));
const destinationArgument = option("worktree", null);
assert(destinationArgument, "Supply a new --worktree directory; existing directories are rejected");
const destination = path.resolve(destinationArgument);
assert(
  destination !== root && !root.startsWith(`${destination}${path.sep}`),
  "Worktree cannot contain the source checkout",
);
const reportPath = path.resolve(option("report", `${destination}.json`));
const target = option("target", "fa93c4290eaa87ae58452ab6e2012f85ae6e0c6b");
const startedAt = new Date().toISOString();
const digest = (value) => createHash("sha256").update(value).digest("hex");

function git(cwd, args, allowFailure = false) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (!allowFailure && result.status !== 0)
    throw new Error(`git ${args.join(" ")}: ${result.stderr || result.error || result.stdout}`);
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
async function sourceSnapshot() {
  const patch = git(root, ["diff", "--binary", "HEAD", "--"]).stdout;
  const untrackedNames = git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .stdout.split("\0")
    .filter(Boolean)
    .sort();
  const untracked = [];
  for (const file of untrackedNames) {
    const info = await fs.lstat(path.join(root, file));
    const bytes = info.isSymbolicLink()
      ? Buffer.from(await fs.readlink(path.join(root, file)))
      : await fs.readFile(path.join(root, file));
    untracked.push({ file, sha256: digest(bytes), symbolicLink: info.isSymbolicLink() });
  }
  return {
    head: git(root, ["rev-parse", "HEAD"]).stdout.trim(),
    branch: git(root, ["symbolic-ref", "--quiet", "HEAD"], true).stdout.trim(),
    stagedDiffSha256: digest(git(root, ["diff", "--cached", "--binary"]).stdout),
    trackedDiffSha256: digest(patch),
    untracked,
    identity: digest(JSON.stringify({ patch, untracked })),
    patch,
  };
}
async function assertAbsent(directory) {
  try {
    await fs.lstat(directory);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Refusing existing worktree directory: ${directory}`);
}
await assertAbsent(destination);
const before = await sourceSnapshot();
const targetSha = git(root, ["rev-parse", `${target}^{commit}`]).stdout.trim();
const commonAncestor = git(root, ["merge-base", before.head, targetSha]).stdout.trim();
const report = {
  startedAt,
  endedAt: null,
  root,
  destination,
  targetSha,
  commonAncestor,
  sourceHead: before.head,
  sourceBranch: before.branch,
  sourceTrackedDiffSha256: before.trackedDiffSha256,
  sourceUntracked: before.untracked,
  sourceIdentity: before.identity,
  snapshotCommit: null,
  merge: null,
  conflicts: [],
  rootBranchAndStagedIndexUnchanged: false,
  validation:
    "Actual Git merge only; no dependency installation, build, behavioral test, or root commit performed",
};
try {
  git(root, ["worktree", "add", "--detach", destination, before.head]);
  if (before.patch) {
    const patchPath = `${destination}.patch`;
    await fs.writeFile(patchPath, before.patch);
    git(destination, ["apply", "--index", "--binary", patchPath]);
    await fs.unlink(patchPath);
  }
  for (const entry of before.untracked) {
    const output = path.join(destination, entry.file);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.cp(path.join(root, entry.file), output, {
      dereference: false,
      verbatimSymlinks: true,
    });
  }
  const copiedSource = await sourceSnapshot();
  assert.equal(
    copiedSource.identity,
    before.identity,
    "Source changed during snapshot; do not present this as a consistent source rehearsal",
  );
  git(destination, ["add", "--all"]);
  const tree = git(destination, ["write-tree"]).stdout.trim();
  const snapshotCommit = git(destination, [
    "-c",
    "user.name=Codex rehearsal",
    "-c",
    "user.email=codex-rehearsal@localhost",
    "commit-tree",
    tree,
    "-p",
    before.head,
    "-m",
    "Temporary dirty-source snapshot for agent session storage merge rehearsal",
  ]).stdout.trim();
  report.snapshotCommit = snapshotCommit;
  // This newly created, task-owned worktree contains exactly the snapshot just staged.
  git(destination, ["reset", "--hard", snapshotCommit]);
  report.merge = git(
    destination,
    [
      "-c",
      "user.name=Codex rehearsal",
      "-c",
      "user.email=codex-rehearsal@localhost",
      "merge",
      "--no-commit",
      "--no-ff",
      "--no-edit",
      targetSha,
    ],
    true,
  );
  report.conflicts = git(destination, ["diff", "--name-only", "--diff-filter=U", "-z"])
    .stdout.split("\0")
    .filter(Boolean);
  report.conflictStages = git(destination, ["ls-files", "--unmerged"]).stdout;
  report.mergedChangeSummary = git(destination, ["diff", "--stat", snapshotCommit]).stdout;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  const after = await sourceSnapshot();
  report.rootBranchAndStagedIndexUnchanged =
    after.head === before.head &&
    after.branch === before.branch &&
    after.stagedDiffSha256 === before.stagedDiffSha256;
  report.sourceChangedAfterSnapshot = after.identity !== before.identity;
  report.endedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  assert(
    report.rootBranchAndStagedIndexUnchanged,
    "Root branch or staged index changed during rehearsal; inspect concurrent changes",
  );
}
process.stdout.write(
  `${JSON.stringify({ report: reportPath, snapshotCommit: report.snapshotCommit, conflicts: report.conflicts, mergeExit: report.merge?.status, error: report.error ?? null }, null, 2)}\n`,
);
