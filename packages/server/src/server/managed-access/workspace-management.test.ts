import { describe, expect, test } from "vitest";
import { SessionInboundMessageSchema, type SessionInboundMessage } from "../messages.js";
import { requiredPermissionForInbound } from "../authorization/operation-permissions.js";
import {
  allowsWorkspaceManagement,
  workspaceManagementTarget,
  type WorkspaceManagementAuthority,
} from "./workspace-management.js";
import type { ProjectPrivilege } from "./types.js";

// workspace.manage operations decided elsewhere, on purpose.
const DECIDED_ELSEWHERE = new Set([
  "close_items_request", // scoped by the agents and terminals it closes
  "workspace.create.request", // its own `workspace.create` rule
]);

function message(type: string, fields: Record<string, unknown> = {}): SessionInboundMessage {
  return { type, requestId: "r", ...fields } as unknown as SessionInboundMessage;
}

/** Project A grants workspace.manage; Project B only project.use. */
function authority(input: { host?: boolean } = {}): WorkspaceManagementAuthority {
  const projects: Record<string, ReadonlySet<ProjectPrivilege>> = {
    "project-a": new Set(["project.use", "workspace.manage"]),
    "project-b": new Set(["project.use"]),
  };
  const workspaces: Record<string, string> = {
    "workspace-a": "project-a",
    "workspace-b": "project-b",
  };
  const projectForPath = (path: string) => {
    if (path.startsWith("/work/a")) return "project-a";
    return path.startsWith("/work/b") ? "project-b" : null;
  };
  const allowsProject = (projectId: string, privilege: ProjectPrivilege) =>
    projects[projectId]?.has(privilege) === true;
  return {
    allowsDaemonPrivilege: (privilege) => input.host === true && privilege === "workspace.manage",
    allowsProject,
    allowsWorkspace: async (workspaceId, privilege) =>
      workspaces[workspaceId] !== undefined && allowsProject(workspaces[workspaceId], privilege),
    allowsCwd: async (cwd, privilege) => {
      const projectId = projectForPath(cwd);
      return projectId !== null && allowsProject(projectId, privilege);
    },
  };
}

describe("workspace.manage operations in a Project-restricted session", () => {
  test("every workspace.manage operation has a target, so none is left unscoped", () => {
    const types = SessionInboundMessageSchema.options.map((option) => option.shape.type.value);
    const managed = types.filter((type) => {
      const requirement = requiredPermissionForInbound(type);
      const permissions = Array.isArray(requirement) ? requirement : [requirement];
      return permissions.includes("workspace.manage") && !type.startsWith("workspace.label.");
    });
    expect(managed.length).toBeGreaterThan(0);
    const uncovered = managed.filter(
      (type) =>
        !DECIDED_ELSEWHERE.has(type) &&
        workspaceManagementTarget(
          message(type, {
            cwd: "/x",
            parentPath: "/x",
            targetDirectory: "/x",
            projectId: "p",
            workspaceId: "w",
          }),
        ) === undefined,
    );
    expect(uncovered).toEqual([]);
  });

  test("a Host grant creates a Project at any path; a Project grant only inside itself", async () => {
    for (const type of ["project.add.request", "open_project_request"]) {
      expect(
        await allowsWorkspaceManagement(
          message(type, { cwd: "/anywhere" }),
          authority({ host: true }),
        ),
      ).toBe(true);
      expect(
        await allowsWorkspaceManagement(message(type, { cwd: "/anywhere" }), authority()),
      ).toBe(false);
      expect(
        await allowsWorkspaceManagement(message(type, { cwd: "/work/a/new" }), authority()),
      ).toBe(true);
      expect(
        await allowsWorkspaceManagement(message(type, { cwd: "/work/b/new" }), authority()),
      ).toBe(false);
    }
    const create = message("project.create_directory.request", {
      parentPath: "/elsewhere",
      name: "n",
    });
    expect(await allowsWorkspaceManagement(create, authority({ host: true }))).toBe(true);
    expect(await allowsWorkspaceManagement(create, authority())).toBe(false);
    const clone = message("project.github.clone.request", { targetDirectory: "/work/a/repo" });
    expect(await allowsWorkspaceManagement(clone, authority())).toBe(true);
  });

  test("managing one Project never reaches another the session can only use", async () => {
    for (const type of [
      "project.rename.request",
      "project.icon.set.request",
      "project.remove.request",
    ]) {
      expect(
        await allowsWorkspaceManagement(message(type, { projectId: "project-a" }), authority()),
      ).toBe(true);
      expect(
        await allowsWorkspaceManagement(message(type, { projectId: "project-b" }), authority()),
      ).toBe(false);
      // A Host grant creates anywhere, but managing still follows each Project's own grant.
      expect(
        await allowsWorkspaceManagement(
          message(type, { projectId: "project-b" }),
          authority({ host: true }),
        ),
      ).toBe(false);
    }
    for (const type of [
      "archive_workspace_request",
      "workspace.recovery.restore.request",
      "workspace.title.set.request",
      "workspace.pin.set.request",
    ]) {
      expect(
        await allowsWorkspaceManagement(message(type, { workspaceId: "workspace-a" }), authority()),
      ).toBe(true);
      expect(
        await allowsWorkspaceManagement(message(type, { workspaceId: "workspace-b" }), authority()),
      ).toBe(false);
    }
  });

  test("worktree operations follow the workspace, then the path, and fail closed without either", async () => {
    const archive = (fields: Record<string, unknown>) =>
      allowsWorkspaceManagement(message("paseo_worktree_archive_request", fields), authority());
    expect(await archive({ workspaceId: "workspace-a" })).toBe(true);
    expect(await archive({ workspaceId: "workspace-b", deleteWorktreeFromDisk: true })).toBe(false);
    expect(await archive({ worktreePath: "/work/b/.worktrees/x" })).toBe(false);
    expect(await archive({})).toBe(false);
    const worktree = (fields: Record<string, unknown>) =>
      allowsWorkspaceManagement(message("create_paseo_worktree_request", fields), authority());
    expect(await worktree({ cwd: "/work/a", projectId: "project-a" })).toBe(true);
    expect(await worktree({ cwd: "/work/a", projectId: "project-b" })).toBe(false);
    expect(await worktree({ cwd: "/work/b" })).toBe(false);
  });

  test("a request naming several resources needs every one, since the handler picks among them", async () => {
    // The archive acts on worktreePath first, so an allowed workspaceId must not cover it.
    expect(
      await allowsWorkspaceManagement(
        message("paseo_worktree_archive_request", {
          workspaceId: "workspace-a",
          worktreePath: "/work/b/.worktrees/x",
          scope: "worktree",
          deleteWorktreeFromDisk: true,
        }),
        authority(),
      ),
    ).toBe(false);
    // A worktree made from another Project's repository must not land in a managed one.
    expect(
      await allowsWorkspaceManagement(
        message("create_paseo_worktree_request", { projectId: "project-a", cwd: "/work/b" }),
        authority(),
      ),
    ).toBe(false);
    expect(
      await allowsWorkspaceManagement(
        message("paseo_worktree_archive_request", {
          workspaceId: "workspace-a",
          worktreePath: "/work/a/.worktrees/x",
        }),
        authority(),
      ),
    ).toBe(true);
  });

  test("leaves every other message to the rest of the authorizer", async () => {
    expect(
      await allowsWorkspaceManagement(message("send_agent_message_request"), authority()),
    ).toBeUndefined();
  });
});
