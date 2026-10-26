import { describe, expect, it } from "vitest";
import type { WorkspaceStructureProject } from "@/projects/workspace-structure";
import {
  mergeQuickChatProjects,
  QUICK_CHAT_PROJECT_VIEW_KEY,
  quickChatProjectKeys,
} from "./quick-chat-projects";

function project(name: string, dir: string, keys: string[]): WorkspaceStructureProject {
  return {
    viewKey: `view:${name}`,
    projectKey: null,
    projectName: name,
    projectKind: "non_git",
    iconWorkingDir: dir,
    hosts: [{ serverId: "srv", projectId: name, iconWorkingDir: dir, worktreeSupport: "unknown" }],
    workspaceKeys: keys,
  };
}

describe("Quick chats in Navigation V2's Workspace list", () => {
  const root = "/home/me/.clisbot/quick-chats";
  const projects = [
    project("alpha-repo", "/code/alpha", ["srv:a1"]),
    project("qc-1", `${root}/qc-1`, ["srv:q1"]),
    project("beta-repo", "/code/beta", ["srv:b1"]),
    project("qc-2", `${root}/qc-2`, ["srv:q2"]),
  ];
  const keys = quickChatProjectKeys(projects, new Map([["srv", root]]));

  it("folds every Quick chat into one project in the first Quick chat's place", () => {
    const merged = mergeQuickChatProjects(projects, keys, "Quick chat");
    expect(merged.map((p) => p.projectName)).toEqual(["alpha-repo", "Quick chat", "beta-repo"]);
    const quick = merged[1]!;
    expect(quick.viewKey).toBe(QUICK_CHAT_PROJECT_VIEW_KEY);
    expect(quick.workspaceKeys).toEqual(["srv:q1", "srv:q2"]);
    expect(quick.hosts.map((host) => host.projectId)).toEqual(["qc-1", "qc-2"]);
  });

  it("leaves a list without Quick chats untouched", () => {
    const plain = [projects[0]!, projects[2]!];
    expect(mergeQuickChatProjects(plain, keys, "Quick chat")).toBe(plain);
  });
});
