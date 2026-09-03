import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";

import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { BoundCreateAgentCommand } from "../agent/create-agent/create.js";
import { assertProjectCwdPlacement } from "../managed-access/resource-authorizer.js";
import type {
  PersistedProjectRecord,
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "../workspace-registry.js";
import { DaemonExecutions } from "./daemon-executions.js";

let temporaryRoot: string | null = null;

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = null;
});

test("Project-bound Hub execution rejects traversal and symlink cwd before Agent creation", async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "paseo-hub-project-placement-"));
  const projectRoot = path.join(temporaryRoot, "project");
  const foreignRoot = path.join(temporaryRoot, "foreign");
  await Promise.all([mkdir(projectRoot), mkdir(foreignRoot)]);
  const foreignLink = path.join(projectRoot, "foreign-link");
  await symlink(foreignRoot, foreignLink, process.platform === "win32" ? "junction" : "dir");

  const project = projectRecord("project-a", projectRoot);
  const workspace = workspaceRecord("workspace-a", project.projectId, projectRoot);
  const projectRegistry = {
    get: async (projectId: string) => (projectId === project.projectId ? project : null),
    list: async () => [project],
  } as Pick<ProjectRegistry, "get" | "list">;
  const workspaceRegistry = {
    list: async () => [workspace],
  } as Pick<WorkspaceRegistry, "list">;
  const createAgent = vi.fn();
  const executions = new DaemonExecutions({
    daemonId: "daemon-a",
    agentManager: {} as AgentManager,
    agentStorage: {
      findByDaemonExecution: async () => null,
    } as unknown as AgentStorage,
    createAgent: createAgent as unknown as BoundCreateAgentCommand,
    assertProjectSourcePlacement: (cwd, projectId) =>
      assertProjectCwdPlacement(cwd, projectId, projectRegistry, workspaceRegistry),
    interruptAgent: async () => undefined,
    logger: pino({ level: "silent" }),
  });

  for (const [executionId, cwd] of [
    ["traversal", `${projectRoot}/../foreign`],
    ["symlink", foreignLink],
  ] as const) {
    await expect(
      executions.create({
        executionId,
        provider: "codex",
        cwd,
        projectId: project.projectId,
        prompt: "Do not create",
      }),
    ).rejects.toThrow("does not belong to Project");
  }
  expect(createAgent).not.toHaveBeenCalled();
});

function projectRecord(projectId: string, rootPath: string): PersistedProjectRecord {
  return {
    projectId,
    rootPath,
    kind: "git",
    displayName: projectId,
    projectKey: null,
    customName: null,
    customIconRevision: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
  };
}

function workspaceRecord(
  workspaceId: string,
  projectId: string,
  cwd: string,
): PersistedWorkspaceRecord {
  return {
    workspaceId,
    projectId,
    cwd,
    kind: "local_checkout",
    displayName: workspaceId,
    title: null,
    branch: null,
    worktreeRoot: cwd,
    baseBranch: null,
    isPaseoOwnedWorktree: false,
    mainRepoRoot: cwd,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    autoArchivedChangeRequestUrl: null,
    pinnedAt: null,
  };
}
