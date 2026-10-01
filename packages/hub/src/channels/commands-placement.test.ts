import { describe, expect, it } from "vitest";
import { runPlacementCommand, type PlacementCommandContext } from "./commands-placement.js";
import type { DaemonConnection } from "./daemon/client.js";
import type { ProjectSnapshot, WorkspaceSnapshot } from "./daemon/types.js";
import type { ChannelTextCommand } from "./commands.js";

const projects: ProjectSnapshot[] = [
  {
    projectId: "project-a",
    projectDisplayName: "Alpha",
    projectRootPath: "/repo/alpha",
    projectKind: "git",
  },
  {
    projectId: "project-b",
    projectDisplayName: "Beta",
    projectRootPath: "/repo/beta",
    projectKind: "git",
  },
];
const worktree: WorkspaceSnapshot = {
  id: "wks_beta",
  projectId: "project-b",
  projectDisplayName: "Beta",
  projectRootPath: "/repo/beta",
  workspaceDirectory: "/tmp/beta-worktree",
  workspaceKind: "worktree",
  name: "beta-feature",
  worktreeSlug: "beta-feature",
};

function fixture(
  selection: Record<string, unknown> = {},
  authorized = new Set(["project-a", "project-b"]),
) {
  let saved: Record<string, unknown> | undefined = selection;
  const created: { input?: unknown } = {};
  const daemon = {
    listProjects: async () => projects,
    listWorkspaces: async () => [worktree],
    createWorkspace: async (input: unknown) => {
      created.input = input;
      return { workspaceId: "wks_new" };
    },
  } as unknown as DaemonConnection;
  const input = {
    command: { name: "project", value: "project-b" } as ChannelTextCommand,
    plane: {
      resolveAgentAccessTarget: () => ({ daemonReference: "daemon", projectId: "project-a" }),
      commandAccess: {
        authorizeChannelPrivilege: async (request: { projectId?: string }) => ({
          allowed: request.projectId === undefined || authorized.has(request.projectId),
        }),
      },
    },
    daemon,
    store: {
      findConversationSelection: async () => (saved === undefined ? undefined : (saved as never)),
    },
    message: {
      channel: "slack",
      accountId: "account",
      senderIdentity: "slack:U1",
      text: "",
      mentionedBot: true,
      conversation: { kind: "dm", id: "C1", rootConversationId: "C1", threadId: null },
    },
    account: { accountId: "account", channel: "slack" },
    route: { target: { kind: "agent", agent: "worker", environment: "repo" } },
    selectionKey: {} as never,
    routeConfig: { provider: "codex", cwd: "/repo/alpha", projectId: "project-a" },
  } as unknown as PlacementCommandContext;
  return { input, created, setSelection: (next: Record<string, unknown>) => (saved = next) };
}

describe("placement slash commands", () => {
  it("selects a Project by id and persists its root for the next session", async () => {
    const { input } = fixture();
    const result = await runPlacementCommand(input);
    expect(result.selection).toEqual({
      selectedProjectId: "project-b",
      selectedProjectRoot: "/repo/beta",
      selectedWorkspaceId: null,
    });
  });

  it("creates a worktree from the selected Project and selects the returned workspace", async () => {
    const { input, created } = fixture({
      selectedProjectId: "project-b",
      selectedProjectRoot: "/repo/beta",
      selectedWorkspaceId: null,
    });
    input.command = { name: "worktree", value: "new feature/login main" };
    const result = await runPlacementCommand(input);
    expect(created.input).toMatchObject({
      projectId: "project-b",
      source: {
        kind: "worktree",
        action: "branch-off",
        branchName: "feature/login",
        baseBranch: "main",
      },
    });
    expect(result.selection?.selectedWorkspaceId).toBe("wks_new");
  });

  it("does not list Projects the sender cannot use", async () => {
    const { input } = fixture({}, new Set(["project-a"]));
    input.command = { name: "project", value: "list" };
    const result = await runPlacementCommand(input);
    expect(result.text).toContain("project-a");
    expect(result.text).not.toContain("project-b");
  });
});
