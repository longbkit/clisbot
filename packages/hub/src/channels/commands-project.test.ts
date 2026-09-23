import { describe, expect, it, vi, type Mock } from "vitest";
import type { ChannelPrivilegeRequest } from "../access/store.js";
import type { ChannelConversationKey } from "../db/channel-access.js";
import type { ChannelStore } from "../db/channels.js";
import type { DaemonConnection } from "./daemon/client.js";
import type { DaemonProject } from "./daemon/types.js";
import { runProjectCommand, type ProjectCommandDependencies } from "./commands-project.js";
import type { LifecycleCommandContext } from "./commands-lifecycle.js";
import type { ChannelPlaneDeps } from "./plane/types.js";
import type {
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
  RouteTarget,
} from "./config/compile.js";

const defaults: EffectiveDefaults = {
  requireMention: true,
  followUp: { mode: "auto", ttlMinutes: 60 },
  bindingKey: "thread",
  replyAnchor: "thread",
  outbound: { path: "relay", template: null },
  inbound: { reactionNotifications: "off", editNotifications: "off" },
  sync: {
    finalAnswers: true,
    progress: { progressMessage: false, typingIndicator: false, messageReaction: "off" },
    toolCalls: false,
    threadLink: "final-only",
    subagents: { finalAnswers: false, progress: false, toolCalls: false },
  },
};

const route: CompiledRoute = {
  audienceRules: [],
  where: { dm: false, groups: ["all"], conversations: [] },
  target: { kind: "agent", agent: "worker", environment: "repo", template: null },
  defaultRoles: [],
  assignments: [],
  defaults,
  approval: [],
};

const account: CompiledChannelAccount = {
  channel: "slack",
  accountId: "work",
  enabled: true,
  channelEnabled: true,
  connectionId: "connection",
  transport: {},
  config: {},
  defaultRoles: [],
  assignments: [],
  defaults,
  approval: [],
  routes: [route],
};

interface SelectionWrite {
  selectedProjectId?: string | null;
  selectedProjectRoot?: string | null;
  selectedRoutePosition?: number | null;
  selectedRouteFingerprint?: string | null;
  selectedDaemonReference?: string | null;
  selectedBy?: string;
}

interface Mocks {
  listProjects: Mock<() => Promise<DaemonProject[]>>;
  authorize: Mock<(request: ChannelPrivilegeRequest) => Promise<{ allowed: boolean }>>;
  setSelection: Mock<
    (key: ChannelConversationKey, selection: SelectionWrite) => Promise<undefined>
  >;
  findSelection: Mock<(key: ChannelConversationKey) => Promise<undefined>>;
  deps: ProjectCommandDependencies;
}

function makeDeps(
  options: {
    projects?: DaemonProject[];
    allowedProjectIds?: string[];
    authorizeConfiguration?: boolean;
  } = {},
): Mocks {
  const projects = options.projects ?? [];
  const allowed = new Set(options.allowedProjectIds ?? projects.map((p) => p.projectId));
  const authorizeConfiguration = options.authorizeConfiguration ?? true;

  const listProjects = vi.fn<() => Promise<DaemonProject[]>>(async () => projects);
  const authorize = vi.fn<(request: ChannelPrivilegeRequest) => Promise<{ allowed: boolean }>>(
    async (request) => ({ allowed: allowed.has(request.projectId ?? "") }),
  );
  const setSelection = vi.fn<
    (key: ChannelConversationKey, selection: SelectionWrite) => Promise<undefined>
  >(async () => undefined);
  const findSelection = vi.fn<(key: ChannelConversationKey) => Promise<undefined>>(
    async () => undefined,
  );

  const plane = {
    organizationId: "org-1",
    resolveAgentAccessTarget: (target: Extract<RouteTarget, { kind: "agent" }>) => ({
      daemonReference: "daemon-1",
      projectId: target.projectId,
      projectRoot: target.projectRoot,
    }),
    commandAccess: {
      authorizeChannelPrivilege: authorize,
      authorizeChannelAccountManagement: async () => ({ membershipId: "m", userId: "u" }),
    },
  } as unknown as ChannelPlaneDeps;

  const daemon = { listProjects } as unknown as DaemonConnection;

  const store = {
    access: {
      setConversationSelection: setSelection,
      findConversationSelection: findSelection,
    },
  } as unknown as ChannelStore;
  const deps: ProjectCommandDependencies = {
    plane,
    daemon,
    store,
    authorizeConfiguration: async () =>
      authorizeConfiguration
        ? { allowed: true }
        : { allowed: false, reason: "Project configuration is not authorized." },
  };
  return { listProjects, authorize, setSelection, findSelection, deps };
}

function makeContext(overrides: Partial<LifecycleCommandContext> = {}): LifecycleCommandContext {
  return {
    message: {
      channel: "slack",
      accountId: "work",
      senderIdentity: "slack:U1",
      text: "/project",
      mentionedBot: true,
      conversation: {
        kind: "thread",
        id: "C1",
        rootConversationId: "C1",
        threadId: "T1",
      },
    },
    account,
    route,
    post: async () => true,
    ...overrides,
  };
}

describe("runProjectCommand", () => {
  it("refuses on a workflow route", async () => {
    const { deps } = makeDeps();
    const context = makeContext({
      route: { ...route, target: { kind: "workflow", workflow: "wf" } },
    });
    const result = await runProjectCommand(deps, undefined, context);
    expect(result.handled).toBe(true);
    expect(result.detail).toMatch(/automation route/i);
  });

  it("lists only accessible projects", async () => {
    const projects: DaemonProject[] = [
      { projectId: "p1", name: "Alpha", rootPath: "/a", kind: "git" },
      { projectId: "p2", name: "Beta", rootPath: "/b", kind: "git" },
    ];
    const { deps, listProjects } = makeDeps({ projects, allowedProjectIds: ["p1"] });
    const result = await runProjectCommand(deps, "list", makeContext());
    expect(listProjects).toHaveBeenCalled();
    expect(result.detail).toContain("Alpha");
    expect(result.detail).not.toContain("Beta");
  });

  it("selects a project by exact id", async () => {
    const projects: DaemonProject[] = [
      { projectId: "p1", name: "Alpha", rootPath: "/a", kind: "git" },
    ];
    const { deps, setSelection } = makeDeps({ projects });
    const result = await runProjectCommand(deps, "p1", makeContext());
    expect(setSelection).toHaveBeenCalledTimes(1);
    const call = setSelection.mock.calls[0];
    expect(call).toBeDefined();
    const [key, selection] = call!;
    expect(selection.selectedProjectId).toBe("p1");
    expect(selection.selectedProjectRoot).toBe("/a");
    expect(key.externalThreadId).toBe("T1");
    expect(result.detail).toContain("p1");
  });

  it("selects a project by exact name (case-insensitive)", async () => {
    const projects: DaemonProject[] = [
      { projectId: "p1", name: "Alpha", rootPath: "/a", kind: "git" },
    ];
    const { deps, setSelection } = makeDeps({ projects });
    await runProjectCommand(deps, "ALPHA", makeContext());
    expect(setSelection).toHaveBeenCalledTimes(1);
    const call = setSelection.mock.calls[0];
    expect(call).toBeDefined();
    expect(call![1].selectedProjectId).toBe("p1");
  });

  it("rejects an ambiguous project name", async () => {
    const projects: DaemonProject[] = [
      { projectId: "p1", name: "Shared", rootPath: "/a", kind: "git" },
      { projectId: "p2", name: "Shared", rootPath: "/b", kind: "git" },
    ];
    const { deps, setSelection } = makeDeps({ projects });
    const result = await runProjectCommand(deps, "shared", makeContext());
    expect(setSelection).not.toHaveBeenCalled();
    expect(result.detail).toMatch(/not found/i);
  });

  it("rejects a project the caller cannot access", async () => {
    const projects: DaemonProject[] = [
      { projectId: "p1", name: "Alpha", rootPath: "/a", kind: "git" },
    ];
    const { deps, setSelection } = makeDeps({ projects, allowedProjectIds: [] });
    const result = await runProjectCommand(deps, "p1", makeContext());
    expect(setSelection).not.toHaveBeenCalled();
    expect(result.detail).toMatch(/not found/i);
  });

  it("refuses a Project whose Agent configuration is not authorized", async () => {
    const projects: DaemonProject[] = [
      { projectId: "p1", name: "Alpha", rootPath: "/a", kind: "git" },
    ];
    const { deps, setSelection } = makeDeps({
      projects,
      allowedProjectIds: ["p1"],
      authorizeConfiguration: false,
    });
    const result = await runProjectCommand(deps, "p1", makeContext());
    expect(setSelection).not.toHaveBeenCalled();
    expect(result.detail).toMatch(/not found or unavailable/i);
  });

  it("clears the selection without querying the host", async () => {
    const { deps, listProjects, setSelection } = makeDeps();
    const result = await runProjectCommand(deps, "clear", makeContext());
    expect(listProjects).not.toHaveBeenCalled();
    expect(setSelection).toHaveBeenCalledTimes(1);
    const call = setSelection.mock.calls[0];
    expect(call).toBeDefined();
    const [key, selection] = call!;
    expect(selection.selectedProjectId).toBeNull();
    expect(selection.selectedProjectRoot).toBeNull();
    expect(key.externalThreadId).toBe("T1");
    expect(result.detail).toMatch(/cleared/i);
  });

  it("scopes the selection key to the topic", async () => {
    const projects: DaemonProject[] = [
      { projectId: "p1", name: "Alpha", rootPath: "/a", kind: "git" },
    ];
    const { deps, setSelection } = makeDeps({ projects });
    await runProjectCommand(deps, "p1", makeContext());
    const call = setSelection.mock.calls[0];
    expect(call).toBeDefined();
    const [key] = call!;
    expect(key.organizationId).toBe("org-1");
    expect(key.channel).toBe("slack");
    expect(key.accountId).toBe("work");
    expect(key.externalConversationId).toBe("C1");
    expect(key.externalThreadId).toBe("T1");
  });
});
