import { describe, expect, it } from "vitest";
import {
  isWorkspaceConfigurationValid,
  parseWorktreeTarget,
  workspaceConfigurationFromTarget,
  worktreeTargetFromConfiguration,
} from "./workspace-configuration";

describe("Workspace configuration", () => {
  it("uses the Project folder when no worktree target is configured", () => {
    const value = workspaceConfigurationFromTarget(undefined);
    expect(value.behavior).toBe("project");
    expect(isWorkspaceConfigurationValid(value)).toBe(true);
    expect(worktreeTargetFromConfiguration(value)).toBeUndefined();
  });

  it("round-trips every existing worktree target shape", () => {
    const targets = [
      { mode: "branch-off", newBranch: "feature/one", base: "main" },
      { mode: "checkout-branch", branch: "release/next" },
      { mode: "checkout-pr", prNumber: 123 },
    ] as const;
    for (const target of targets) {
      const value = workspaceConfigurationFromTarget(target);
      expect(isWorkspaceConfigurationValid(value)).toBe(true);
      expect(worktreeTargetFromConfiguration(value)).toEqual(target);
    }
  });

  it("rejects incomplete UI values and malformed authored targets", () => {
    const value = workspaceConfigurationFromTarget(undefined);
    expect(isWorkspaceConfigurationValid({ ...value, behavior: "branch-off" })).toBe(false);
    expect(
      isWorkspaceConfigurationValid({
        ...value,
        behavior: "checkout-pr",
        pullRequestNumber: "0",
      }),
    ).toBe(false);
    expect(parseWorktreeTarget({ mode: "checkout-pr", prNumber: "12" })).toBeNull();
    expect(
      parseWorktreeTarget({
        mode: "checkout-branch",
        branch: "main",
        unexpected: true,
      }),
    ).toBeNull();
  });
});
