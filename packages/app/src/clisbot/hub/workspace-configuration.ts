export type WorktreeTarget =
  | { mode: "branch-off"; newBranch: string; base?: string }
  | { mode: "checkout-branch"; branch: string }
  | { mode: "checkout-pr"; prNumber: number };

export type WorkspaceBehavior = "project" | "branch-off" | "checkout-branch" | "checkout-pr";

export interface WorkspaceConfigurationValue {
  behavior: WorkspaceBehavior;
  newBranch: string;
  base: string;
  branch: string;
  pullRequestNumber: string;
}

export function workspaceConfigurationFromTarget(value: unknown): WorkspaceConfigurationValue {
  const target = parseWorktreeTarget(value);
  if (target?.mode === "branch-off") {
    return {
      behavior: "branch-off",
      newBranch: target.newBranch,
      base: target.base ?? "",
      branch: "",
      pullRequestNumber: "",
    };
  }
  if (target?.mode === "checkout-branch") {
    return {
      behavior: "checkout-branch",
      newBranch: "",
      base: "",
      branch: target.branch,
      pullRequestNumber: "",
    };
  }
  if (target?.mode === "checkout-pr") {
    return {
      behavior: "checkout-pr",
      newBranch: "",
      base: "",
      branch: "",
      pullRequestNumber: String(target.prNumber),
    };
  }
  return {
    behavior: "project",
    newBranch: "",
    base: "",
    branch: "",
    pullRequestNumber: "",
  };
}

export function worktreeTargetFromConfiguration(
  value: WorkspaceConfigurationValue,
): WorktreeTarget | undefined {
  if (value.behavior === "project") return undefined;
  if (value.behavior === "branch-off") {
    const newBranch = value.newBranch.trim();
    if (newBranch.length === 0) return undefined;
    const base = value.base.trim();
    return {
      mode: "branch-off",
      newBranch,
      ...(base.length === 0 ? {} : { base }),
    };
  }
  if (value.behavior === "checkout-branch") {
    const branch = value.branch.trim();
    return branch.length === 0 ? undefined : { mode: "checkout-branch", branch };
  }
  const prNumber = Number(value.pullRequestNumber.trim());
  return Number.isSafeInteger(prNumber) && prNumber > 0
    ? { mode: "checkout-pr", prNumber }
    : undefined;
}

export function isWorkspaceConfigurationValid(value: WorkspaceConfigurationValue): boolean {
  return value.behavior === "project" || worktreeTargetFromConfiguration(value) !== undefined;
}

export function parseWorktreeTarget(value: unknown): WorktreeTarget | null {
  if (!isRecord(value)) return null;
  if (value["mode"] === "branch-off") {
    const newBranch = nonEmptyString(value["newBranch"]);
    const base = optionalNonEmptyString(value["base"]);
    if (newBranch === null || base === null || !hasOnlyKeys(value, ["mode", "newBranch", "base"])) {
      return null;
    }
    return {
      mode: "branch-off",
      newBranch,
      ...(base === undefined ? {} : { base }),
    };
  }
  if (value["mode"] === "checkout-branch") {
    const branch = nonEmptyString(value["branch"]);
    return branch !== null && hasOnlyKeys(value, ["mode", "branch"])
      ? { mode: "checkout-branch", branch }
      : null;
  }
  if (value["mode"] === "checkout-pr") {
    const prNumber = value["prNumber"];
    return Number.isSafeInteger(prNumber) &&
      Number(prNumber) > 0 &&
      hasOnlyKeys(value, ["mode", "prNumber"])
      ? { mode: "checkout-pr", prNumber: Number(prNumber) }
      : null;
  }
  return null;
}

function optionalNonEmptyString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return nonEmptyString(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const names = new Set(allowed);
  return Object.keys(value).every((key) => names.has(key));
}
