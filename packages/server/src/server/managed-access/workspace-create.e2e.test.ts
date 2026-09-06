import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { expect, test } from "vitest";
import { Session, type SessionOptions } from "../session.js";
import type { SessionOutboundMessage } from "../messages.js";
import { FileBackedProjectRegistry, FileBackedWorkspaceRegistry } from "../workspace-registry.js";
import { WorkspaceGitServiceImpl } from "../workspace-git-service.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { createStub } from "../test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "../test-utils/session-stubs.js";

test("Project authority creates a real worktree then an Agent without Project administration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "managed-workspace-e2e-"));
  const repo = path.join(root, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "pipe" });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "Initial",
    ],
    { cwd: repo, stdio: "pipe" },
  );
  const daemon = await createTestPaseoDaemon();
  const logger = pino({ level: "silent" });
  const projects = new FileBackedProjectRegistry(path.join(root, "projects.json"), logger);
  const workspaces = new FileBackedWorkspaceRegistry(path.join(root, "workspaces.json"), logger);
  await Promise.all([projects.initialize(), workspaces.initialize()]);
  const project = await projects.getOrCreateActiveByRoot({
    rootPath: repo,
    kind: "git",
    displayName: "Repo",
    timestamp: new Date().toISOString(),
  });
  const workspaceGitService = new WorkspaceGitServiceImpl({
    logger,
    paseoHome: daemon.paseoHome,
  });
  const messages: SessionOutboundMessage[] = [];
  const snapshot = createProviderSnapshotManagerStub();
  snapshot.manager.isUnattendedConfiguration = async () => false;
  const session = new Session({
    clientId: "managed-client",
    permissions: ["daemon.read", "workspace.read", "workspace.write"],
    resourceAuthorization: {
      resourceMode: "projects",
      leaseId: "managed-lease",
      leaseExpiresAt: Date.now() + 60_000,
      projects: new Map([
        [
          project.projectId,
          {
            privileges: new Set([
              "project.use",
              "workspace.create",
              "agent.create",
              "agent.interact",
            ] as const),
            agentConfigurations: [{ providerId: "codex", modelIds: "*", thinkingOptionIds: "*" }],
          },
        ],
      ]),
    },
    logger,
    paseoHome: daemon.paseoHome,
    onMessage: (message) => messages.push(message),
    downloadTokenStore: createStub<SessionOptions["downloadTokenStore"]>({}),
    pushNotifications: createStub<SessionOptions["pushNotifications"]>({}),
    agentManager: daemon.daemon.agentManager,
    agentStorage: daemon.daemon.agentStorage,
    projectRegistry: projects,
    workspaceRegistry: workspaces,
    workspaceGitService,
    terminalManager: null,
    scheduleService: createStub<SessionOptions["scheduleService"]>({}),
    checkoutDiffManager: createStub<SessionOptions["checkoutDiffManager"]>({
      scheduleRefreshForCwd: () => {},
      onWorkspaceStateMayHaveChanged: () => {},
    }),
    workspaceAutoName: createStub<SessionOptions["workspaceAutoName"]>({
      scheduleForWorktree: () => {},
      scheduleForDirectory: () => {},
    }),
    daemonConfigStore: createStub<SessionOptions["daemonConfigStore"]>({
      get: () => ({ mcp: { injectIntoAgents: false }, providers: {} }),
      onChange: () => () => {},
    }),
    providerSnapshotManager: snapshot.manager,
    stt: null,
    tts: null,
  });
  try {
    await session.handleMessage({
      type: "workspace.create.request",
      requestId: "create",
      source: {
        kind: "worktree",
        projectId: project.projectId,
        cwd: repo,
        worktreeSlug: "managed-work",
        baseBranch: "main",
      },
    });
    const response = messages.find((message) => message.type === "workspace.create.response");
    if (response?.type !== "workspace.create.response") throw new Error(JSON.stringify(messages));
    expect(response.payload.error).toBeNull();
    expect(response.payload.workspace?.projectId).toBe(project.projectId);
    const created = response.payload.workspace!;
    expect(
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: created.workspaceDirectory,
        encoding: "utf8",
      }).trim(),
    ).toBe(created.workspaceDirectory);
    expect((await workspaces.get(created.id))?.projectId).toBe(project.projectId);
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "workspace_update",
        payload: expect.objectContaining({
          kind: "upsert",
          workspace: expect.objectContaining({ id: created.id, projectId: project.projectId }),
        }),
      }),
    );
    expect(await projects.list()).toHaveLength(1);
    expect(session.allowsPermission("workspace.manage")).toBe(false);
    await session.handleMessage({
      type: "project.add.request",
      requestId: "add-project",
      cwd: root,
    });
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "rpc_error",
        payload: expect.objectContaining({ requestId: "add-project" }),
      }),
    );
    await session.handleMessage({
      type: "create_agent_request",
      requestId: "agent",
      config: { provider: "codex", cwd: created.workspaceDirectory },
      workspaceId: created.id,
      labels: {},
    });
    const agentResponse = messages.find(
      (message) =>
        (message.type === "status" &&
          "requestId" in message.payload &&
          message.payload.requestId === "agent") ||
        (message.type === "rpc_error" && message.payload.requestId === "agent"),
    );
    expect(agentResponse, JSON.stringify(agentResponse)).toMatchObject({
      type: "status",
      payload: { status: "agent_created", requestId: "agent" },
    });
  } finally {
    await session.cleanup();
    await workspaceGitService.dispose();
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);
