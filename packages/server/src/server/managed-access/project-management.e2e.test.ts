import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, expect, test } from "vitest";
import { Session, type SessionOptions } from "../session.js";
import type { SessionOutboundMessage } from "../messages.js";
import { FileBackedProjectRegistry, FileBackedWorkspaceRegistry } from "../workspace-registry.js";
import { WorkspaceGitServiceImpl } from "../workspace-git-service.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { createStub } from "../test-utils/class-mocks.js";
import { createProviderSnapshotManagerStub } from "../test-utils/session-stubs.js";
import type { DaemonPermission } from "../authorization/index.js";
import type { ProjectPrivilege } from "./types.js";

const DEVELOPER: ProjectPrivilege[] = [
  "project.use",
  "workspace.create",
  "agent.interact",
  "agent.create",
];
const FULL_ACCESS: ProjectPrivilege[] = [...DEVELOPER, "workspace.manage"];
const SESSION: DaemonPermission[] = ["daemon.read", "workspace.read", "workspace.write"];

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "managed-project-e2e-"));
  const daemon = await createTestPaseoDaemon();
  const logger = pino({ level: "silent" });
  const projects = new FileBackedProjectRegistry(path.join(root, "projects.json"), logger);
  const workspaces = new FileBackedWorkspaceRegistry(path.join(root, "workspaces.json"), logger);
  await Promise.all([projects.initialize(), workspaces.initialize()]);
  const git = new WorkspaceGitServiceImpl({ logger, paseoHome: daemon.paseoHome });
  cleanups.push(async () => {
    await git.dispose();
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  });
  const addProject = async (name: string) => {
    const rootPath = path.join(root, name);
    await mkdir(rootPath, { recursive: true });
    return projects.getOrCreateActiveByRoot({
      rootPath,
      kind: "non_git",
      displayName: name,
      timestamp: new Date().toISOString(),
    });
  };

  /** A real Session admitted the way a Hub ticket would admit it. */
  const open = (grant: {
    permissions: DaemonPermission[];
    projects: Record<string, ProjectPrivilege[]>;
    daemonPrivileges?: ProjectPrivilege[];
  }) => {
    const messages: SessionOutboundMessage[] = [];
    const snapshot = createProviderSnapshotManagerStub();
    const session = new Session({
      clientId: `client-${Math.random()}`,
      permissions: grant.permissions,
      resourceAuthorization: {
        resourceMode: "projects",
        leaseId: "managed-lease",
        leaseExpiresAt: Date.now() + 60_000,
        projects: new Map(
          Object.entries(grant.projects).map(([projectId, privileges]) => [
            projectId,
            {
              privileges: new Set(privileges),
              agentConfigurations: [{ providerId: "codex", modelIds: "*", thinkingOptionIds: "*" }],
            },
          ]),
        ),
        ...(grant.daemonPrivileges ? { daemonPrivileges: new Set(grant.daemonPrivileges) } : {}),
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
      workspaceGitService: git,
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
    cleanups.push(() => session.cleanup());
    /** The response to one request: its payload, or "denied" when the session refused it. */
    const request = async (message: Record<string, unknown>) => {
      const requestId = String(message.requestId);
      await session.handleMessage(message as never);
      const reply = messages.find(
        (candidate) =>
          "payload" in candidate &&
          typeof candidate.payload === "object" &&
          candidate.payload !== null &&
          (candidate.payload as { requestId?: string }).requestId === requestId,
      );
      if (reply === undefined)
        throw new Error(`no reply to ${requestId}: ${JSON.stringify(messages)}`);
      return reply.type === "rpc_error" ? "denied" : (reply.payload as Record<string, unknown>);
    };
    return { request };
  };
  return { root, projects, addProject, open };
}

test("Full access on a Host adds a Project in a folder no Project covers", async () => {
  const { root, projects, addProject, open } = await fixture();
  const repo = await addProject("repo");
  const outside = path.join(root, "anywhere");
  await mkdir(outside);
  const host = open({
    permissions: [...SESSION, "workspace.manage"],
    projects: { [repo.projectId]: FULL_ACCESS },
    daemonPrivileges: FULL_ACCESS,
  });
  const added = await host.request({ type: "project.add.request", requestId: "add", cwd: outside });
  expect(added).toMatchObject({ error: null, project: expect.objectContaining({}) });
  const created = (await projects.list()).find(({ rootPath }) => rootPath === outside);
  expect(created).toBeDefined();
  // The ticket this session was admitted with does not cover the new Project yet.
  expect(
    await host.request({
      type: "project.rename.request",
      requestId: "rename-new",
      projectId: created!.projectId,
      customName: "New",
    }),
  ).toBe("denied");
});

test("Full access on one Project adds Projects only inside it", async () => {
  const { root, projects, addProject, open } = await fixture();
  const repo = await addProject("repo");
  const inside = path.join(repo.rootPath, "packages", "app");
  const outside = path.join(root, "anywhere");
  await Promise.all([mkdir(inside, { recursive: true }), mkdir(outside)]);
  const project = open({
    permissions: [...SESSION, "workspace.manage"],
    projects: { [repo.projectId]: FULL_ACCESS },
  });
  expect(
    await project.request({ type: "project.add.request", requestId: "out", cwd: outside }),
  ).toBe("denied");
  expect(
    await project.request({ type: "project.add.request", requestId: "in", cwd: inside }),
  ).toMatchObject({
    error: null,
  });
  expect((await projects.list()).map(({ rootPath }) => rootPath)).toEqual(
    expect.arrayContaining([repo.rootPath, inside]),
  );
  // The nested Project is a new Project that no grant names, and the deepest
  // Project owns its folder: its own creator no longer reaches inside it.
  await mkdir(path.join(inside, "deeper"));
  expect(
    await project.request({
      type: "project.add.request",
      requestId: "deeper",
      cwd: path.join(inside, "deeper"),
    }),
  ).toBe("denied");
});

test("Developer adds no Project, even inside one it works in", async () => {
  const { addProject, open } = await fixture();
  const repo = await addProject("repo");
  const inside = path.join(repo.rootPath, "sub");
  await mkdir(inside);
  const developer = open({ permissions: SESSION, projects: { [repo.projectId]: DEVELOPER } });
  expect(
    await developer.request({ type: "project.add.request", requestId: "add", cwd: inside }),
  ).toBe("denied");
});

test("managing one Project does not reach another the session can only use", async () => {
  const { projects, addProject, open } = await fixture();
  const managed = await addProject("managed");
  const usedOnly = await addProject("used-only");
  const session = open({
    permissions: [...SESSION, "workspace.manage"],
    projects: { [managed.projectId]: FULL_ACCESS, [usedOnly.projectId]: DEVELOPER },
  });
  const rename = (projectId: string, requestId: string) =>
    session.request({
      type: "project.rename.request",
      requestId,
      projectId,
      customName: "Renamed",
    });
  expect(await rename(usedOnly.projectId, "other")).toBe("denied");
  expect(
    await session.request({
      type: "project.remove.request",
      requestId: "rm",
      projectId: usedOnly.projectId,
    }),
  ).toBe("denied");
  expect(await rename(managed.projectId, "own")).toMatchObject({ accepted: true, error: null });
  expect((await projects.get(usedOnly.projectId))?.archivedAt ?? null).toBeNull();
});
