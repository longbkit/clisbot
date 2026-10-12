import { ChannelPlacementCommands, placementSelectionKey } from "./commands-placement.js";
import { ChannelCommandDispatcher } from "./commands-dispatch.js";
import { placementRouteFingerprint } from "./placement-selection.js";
import { configurationDaemonStub } from "./daemon/test-support.js";
import type { ChannelPlaneDeps } from "./plane/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ChannelStore } from "../db/channels.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../db/runtime/index.js";
import {
  ChannelLifecycleCommands,
  type LifecycleCommandContext,
  type LifecycleCommandDependencies,
} from "./commands-lifecycle.js";
import type { CompiledChannelAccount, CompiledRoute, EffectiveDefaults } from "./config/compile.js";
import type { DaemonConnection } from "./daemon/client.js";
import type { AgentSnapshot } from "./daemon/types.js";

let bundle: DatabaseRuntimeBundle;
let directory: string;
let store: ChannelStore;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "channel-lifecycle-"));
  bundle = await embeddedDatabaseRuntime(directory);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    "insert into organization (id, name, slug) values ('lifecycle', 'Lifecycle', 'lifecycle')",
  );
  store = new ChannelStore(bundle.runtime);
}, 60_000);
afterAll(async () => {
  await bundle.runtime.close();
  await rm(directory, { recursive: true, force: true });
});

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
let fixtureId = 0;
function snapshot(id: string, workspaceId?: string): AgentSnapshot {
  return {
    id,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    provider: "codex",
    cwd: "/repo",
    title: null,
    status: "running",
    createdAt: "",
    updatedAt: "",
    labels: {},
  };
}
function fixture(overrides: Partial<LifecycleCommandDependencies> = {}) {
  const id = ++fixtureId;
  const old = snapshot(`old-${id}`, "workspace-old"),
    target = snapshot(`target-${id}`),
    created = snapshot(`new-${id}`);
  const order: string[] = [];
  const attachment = {
    type: "text" as const,
    mimeType: "text/plain" as const,
    text: "prior conversation",
    contextKind: "chat_history" as const,
    sourceSession: { agentId: "source-session", epoch: "source-epoch", seq: 12 },
  };
  const sendAgentMessage = vi.fn<DaemonConnection["sendAgentMessage"]>(async () => {
    order.push("send");
  });
  const cancelAgent = vi.fn(async () => undefined);
  const createAgent = vi.fn(async () => ({ agentId: created.id, agent: created }));
  const createWorkspace = vi.fn<DaemonConnection["createWorkspace"]>(async () => ({
    workspaceId: "workspace-quick",
  }));
  const daemon = {
    listAgents: async () => [old, target],
    sendAgentMessage,
    cancelAgent,
    createAgent,
    createWorkspace,
    getServerInfo: () => ({
      features: { agentForkContext: true, workspaceMultiplicity: true },
    }),
    buildAgentForkContext: vi.fn(async () => ({ attachment, itemCount: 2 })),
  } as unknown as DaemonConnection;
  const context: LifecycleCommandContext = {
    message: {
      channel: "slack",
      accountId: "work",
      senderIdentity: "slack:U1",
      text: "/new",
      mentionedBot: true,
      conversation: {
        kind: "thread",
        id: `C-${id}`,
        rootConversationId: `C-${id}`,
        threadId: "thread",
      },
    },
    account,
    route,
    agentId: old.id,
    post: vi.fn(async () => true),
  };
  const attach = vi.fn(async (_binding: unknown, _context: LifecycleCommandContext) => {
    order.push("attach");
  });
  const detach = vi.fn(async () => undefined),
    authorizeResume = vi.fn(async () => true);
  const dispatchFresh = vi.fn(async (_context: LifecycleCommandContext) => true);
  const resolveConfig = vi.fn(async () => ({
    provider: "codex",
    cwd: "/repo",
    model: "staged-model",
  }));
  const lifecycle = new ChannelLifecycleCommands({
    organizationId: "lifecycle",
    daemon,
    store,
    attach,
    detach,
    authorizeResume,
    dispatchFresh,
    resolveConfig,
    ...overrides,
  });
  const bindingInput = {
    organizationId: "lifecycle",
    channel: "slack" as const,
    accountId: "work",
    externalConversationId: `C-${id}`,
    externalThreadId: "thread",
    initiator: "slack:U1",
    route: {},
  };
  const seed = () =>
    store.rebindThreadBinding({ ...bindingInput, expectedAgentId: null, agentId: old.id });
  const bound = () => store.findThreadBinding("lifecycle", "work", `C-${id}`, "thread");
  return {
    lifecycle,
    context,
    old,
    target,
    created,
    daemon,
    attachment,
    sendAgentMessage,
    cancelAgent,
    createAgent,
    createWorkspace,
    attach,
    detach,
    authorizeResume,
    dispatchFresh,
    resolveConfig,
    order,
    seed,
    bound,
    bindingInput,
  };
}

describe("channel lifecycle commands", () => {
  it("new clears old binding and dispatches exactly the first prompt", async () => {
    const f = fixture();
    await f.seed();
    expect(
      (await f.lifecycle.handle({ name: "new", value: "start fresh" }, f.context))?.handled,
    ).toBe(true);
    expect(await f.bound()).toBeUndefined();
    expect(f.cancelAgent).toHaveBeenCalledWith(f.old.id);
    expect(f.dispatchFresh.mock.calls[0]?.[0]).toMatchObject({
      message: { text: "start fresh", mentionedBot: true },
    });
  });
  it("consumes a successful new command even when acknowledgement delivery fails", async () => {
    const f = fixture();
    await f.seed();
    const post = vi.fn(async () => false);
    const outcome = await f.lifecycle.handle(
      { name: "new", value: "first prompt" },
      { ...f.context, post },
    );
    expect(outcome?.handled).toBe(true);
    expect(outcome?.detail).toContain("Acknowledgement was not delivered");
    expect(f.dispatchFresh).toHaveBeenCalledOnce();
    expect(await f.bound()).toBeUndefined();
  });
  it("resume verifies access and replaces old binding", async () => {
    const f = fixture();
    await f.seed();
    await f.lifecycle.handle({ name: "resume", value: f.target.id }, f.context);
    expect((await f.bound())?.agentId).toBe(f.target.id);
    expect(f.authorizeResume).toHaveBeenCalledWith(f.target, f.context);
    expect(f.detach).toHaveBeenCalledWith(f.old.id);
    expect(f.attach).toHaveBeenCalledOnce();
  });
  it("resuming the bound Agent is a no-op and keeps its live stream buffer", async () => {
    const f = fixture();
    await f.seed();
    const before = await f.bound();
    const outcome = await f.lifecycle.handle({ name: "resume", value: f.old.id }, f.context);
    expect(outcome?.handled).toBe(true);
    expect(await f.bound()).toEqual(before);
    expect(f.attach).not.toHaveBeenCalled();
    expect(f.detach).not.toHaveBeenCalled();
    expect(f.cancelAgent).not.toHaveBeenCalled();
    expect(f.authorizeResume).toHaveBeenCalledOnce();
  });
  it("restores the prior binding when resumed stream attachment fails", async () => {
    const f = fixture();
    await f.seed();
    f.attach.mockRejectedValueOnce(new Error("subscription unavailable"));
    const outcome = await f.lifecycle.handle({ name: "resume", value: f.target.id }, f.context);
    expect(outcome?.handled).toBe(false);
    expect((await f.bound())?.agentId).toBe(f.old.id);
    expect(f.cancelAgent).not.toHaveBeenCalled();
    expect(f.detach).not.toHaveBeenCalledWith(f.old.id);
  });
  it("removes a newly created binding when resume attachment fails from an unbound conversation", async () => {
    const f = fixture();
    f.attach.mockRejectedValueOnce(new Error("subscription unavailable"));
    await f.lifecycle.handle(
      { name: "resume", value: f.target.id },
      { ...f.context, agentId: undefined },
    );
    expect(await f.bound()).toBeUndefined();
    expect(f.cancelAgent).not.toHaveBeenCalled();
  });
  it.each(["attach", "send"])(
    "restores the original binding on fork %s failure without canceling its turn",
    async (stage) => {
      const f = fixture();
      await f.seed();
      if (stage === "attach") f.attach.mockRejectedValueOnce(new Error("subscription unavailable"));
      else f.sendAgentMessage.mockRejectedValueOnce(new Error("prompt rejected"));
      const outcome = await f.lifecycle.handle({ name: "fork", value: "continue" }, f.context);
      expect(outcome?.handled).toBe(false);
      expect((await f.bound())?.agentId).toBe(f.old.id);
      expect(f.cancelAgent).not.toHaveBeenCalledWith(f.old.id);
      expect(f.detach).not.toHaveBeenCalledWith(f.old.id);
      expect(f.cancelAgent).toHaveBeenCalledWith(f.created.id);
      expect(f.detach).toHaveBeenCalledWith(f.created.id);
    },
  );
  it.each(["side", "quick"])(
    "%s explicitly enables its one-off answer when route sync is disabled",
    async (name) => {
      const f = fixture();
      await f.seed();
      const silentContext = {
        ...f.context,
        route: {
          ...route,
          defaults: { ...defaults, sync: { ...defaults.sync, finalAnswers: false } },
        },
      };
      await f.lifecycle.handle({ name, value: "question" }, silentContext);
      expect(f.attach.mock.calls[0]?.[1]).toMatchObject({
        route: {
          defaults: {
            outbound: { path: "relay", template: null },
            sync: { finalAnswers: true },
          },
        },
      });
      expect((await f.bound())?.agentId).toBe(f.old.id);
      expect(silentContext.route.defaults.sync.finalAnswers).toBe(false);
    },
  );
  it("denies unauthorized sessions without revealing existence", async () => {
    const f = fixture();
    await f.seed();
    f.authorizeResume.mockResolvedValue(false);
    const denied = await f.lifecycle.handle({ name: "resume", value: f.target.id }, f.context);
    expect(denied).toEqual(
      await f.lifecycle.handle({ name: "resume", value: "missing" }, f.context),
    );
    expect((await f.bound())?.agentId).toBe(f.old.id);
    expect(f.attach).not.toHaveBeenCalled();
  });
  it("rejects cross-conversation resume without losing the current session", async () => {
    const f = fixture();
    await f.seed();
    await store.rebindThreadBinding({
      ...f.bindingInput,
      externalConversationId: "elsewhere",
      expectedAgentId: null,
      agentId: f.target.id,
    });
    expect(
      (await f.lifecycle.handle({ name: "resume", value: f.target.id }, f.context))?.handled,
    ).toBe(false);
    expect((await f.bound())?.agentId).toBe(f.old.id);
    expect(f.cancelAgent).not.toHaveBeenCalled();
  });
  it("rejects a target bound in a different organization", async () => {
    const f = fixture();
    await f.seed();
    await bundle.runtime.query(
      "insert into organization (id, name, slug) values ('other-lifecycle', 'Other', 'other-lifecycle')",
    );
    await store.rebindThreadBinding({
      ...f.bindingInput,
      organizationId: "other-lifecycle",
      expectedAgentId: null,
      agentId: f.target.id,
    });
    expect(
      (await f.lifecycle.handle({ name: "resume", value: f.target.id }, f.context))?.handled,
    ).toBe(false);
    expect((await f.bound())?.agentId).toBe(f.old.id);
  });
  it("rejects stale rebinds atomically", async () => {
    const f = fixture();
    await f.seed();
    await store.rebindThreadBinding({
      ...f.bindingInput,
      expectedAgentId: f.old.id,
      agentId: f.target.id,
    });
    await expect(
      store.rebindThreadBinding({
        ...f.bindingInput,
        expectedAgentId: f.old.id,
        agentId: f.created.id,
      }),
    ).rejects.toThrow();
    expect((await f.bound())?.agentId).toBe(f.target.id);
  });
  it("fork uses transcript and staged config and subscribes before first send", async () => {
    const f = fixture();
    await f.seed();
    await f.lifecycle.handle({ name: "fork", value: "continue" }, f.context);
    expect((await f.bound())?.agentId).toBe(f.created.id);
    expect(f.createAgent).toHaveBeenCalledWith(expect.objectContaining({ model: "staged-model" }), {
      source: f.context.message,
      workspaceId: "workspace-old",
    });
    expect(f.sendAgentMessage).toHaveBeenCalledWith(f.created.id, "continue", {
      steer: true,
      source: f.context.message,
      attachments: [f.attachment],
    });
    expect(f.order).toEqual(["attach", "send"]);
  });
  it.each(["side", "quick"])(
    "%s preserves binding, auto-archives and removes transient reply routing after terminal",
    async (name) => {
      const f = fixture();
      await f.seed();
      await f.lifecycle.handle({ name, value: "question" }, f.context);
      expect((await f.bound())?.agentId).toBe(f.old.id);
      expect(f.createAgent).toHaveBeenCalledWith(expect.anything(), {
        source: f.context.message,
        autoArchive: true,
        // `/side` continues the bound session, so it inherits its workspace;
        // `/quick` continues nothing and opens its own (A1).
        workspaceId: name === "side" ? "workspace-old" : "workspace-quick",
      });
      expect(f.attach.mock.calls[0]?.[0]).toMatchObject({
        agentId: f.created.id,
        externalConversationId: f.bindingInput.externalConversationId,
      });
      expect(f.detach).not.toHaveBeenCalled();
      await f.lifecycle.onStream(f.created.id, { type: "turn_completed" });
      expect(f.detach).toHaveBeenCalledWith(f.created.id);
      if (name === "quick") expect(f.daemon.buildAgentForkContext).not.toHaveBeenCalled();
      expect(f.order).toEqual(["attach", "send"]);
    },
  );
  it("side keeps the source workspace and its other sessions untouched (A1/A2)", async () => {
    const f = fixture();
    await f.seed();
    await f.lifecycle.handle({ name: "side", value: "question" }, f.context);
    // Nothing renames or re-places the source workspace: no naming context is
    // sent, and the source session keeps its binding (A2/A5).
    expect(f.createWorkspace).not.toHaveBeenCalled();
    expect((await f.bound())?.agentId).toBe(f.old.id);
  });
  it("quick names its own workspace from the request it carries (A3)", async () => {
    const f = fixture();
    await f.seed();
    await f.lifecycle.handle({ name: "quick", value: "what changed today?" }, f.context);
    expect(f.createWorkspace).toHaveBeenCalledWith(
      { cwd: "/repo", firstAgentContext: { prompt: "what changed today?" } },
      { source: f.context.message },
    );
  });
  it("leaves placement to the daemon when workspace organization is off (A6)", async () => {
    const f = fixture();
    await f.seed();
    const context = {
      ...f.context,
      route: {
        ...f.context.route,
        defaults: { ...f.context.route.defaults, workspace: { organize: false } },
      },
    };
    await f.lifecycle.handle({ name: "fork", value: "continue" }, context);
    expect(f.createWorkspace).not.toHaveBeenCalled();
    expect(f.createAgent).toHaveBeenCalledWith(expect.anything(), {
      source: context.message,
    });
  });
  it("refuses unsupported fork hosts before creating a session", async () => {
    const f = fixture();
    f.daemon.getServerInfo = () => undefined;
    expect((await f.lifecycle.handle({ name: "fork" }, f.context))?.handled).toBe(false);
    expect(f.createAgent).not.toHaveBeenCalled();
  });
  it("fork binds a fresh tool capability before sending", async () => {
    const issueCapability = vi.fn(() => ({ token: "fresh-token", canSendFiles: true }));
    const bindCapability = vi.fn(() => true);
    const revokeCapability = vi.fn();
    const f = fixture({ issueCapability, bindCapability, revokeCapability });
    await f.seed();
    const toolRoute = {
      ...route,
      defaults: { ...defaults, outbound: { path: "tool" as const, template: null } },
    };
    const toolContext = {
      ...f.context,
      account: { ...f.context.account, routes: [toolRoute] },
      route: toolRoute,
    };
    await f.lifecycle.handle({ name: "fork", value: "continue" }, toolContext);
    expect(issueCapability).toHaveBeenCalledWith(
      toolContext,
      expect.objectContaining({ cwd: "/repo" }),
    );
    expect(bindCapability).toHaveBeenCalledWith("fresh-token", f.created.id);
    expect(f.resolveConfig).toHaveBeenCalledWith(toolContext, {
      token: "fresh-token",
      canSendFiles: true,
    });
    expect(revokeCapability).not.toHaveBeenCalled();
  });
  it("resume on a tool route persists a relay override without changing captured route policy", async () => {
    const f = fixture();
    await f.seed();
    const toolRoute = {
      ...route,
      defaults: { ...defaults, outbound: { path: "tool" as const, template: null } },
    };
    const toolContext = {
      ...f.context,
      account: { ...f.context.account, routes: [toolRoute] },
      route: toolRoute,
    };
    await f.lifecycle.handle({ name: "resume", value: f.target.id }, toolContext);
    expect((await f.bound())?.route).toMatchObject({
      commandReplyPath: "relay",
      target: route.target,
    });
    expect(f.attach.mock.calls[0]?.[1]).toMatchObject({
      route: { defaults: { outbound: { path: "relay" } } },
    });
  });
  it("refuses lifecycle mutations on automation routes", async () => {
    const f = fixture();
    await f.lifecycle.handle(
      { name: "new" },
      {
        ...f.context,
        route: { ...route, target: { kind: "workflow", workflow: "review" } },
      },
    );
    expect(f.context.post).toHaveBeenLastCalledWith(
      "This command is not available on an automation route.",
    );
    expect(f.cancelAgent).not.toHaveBeenCalled();
  });
  it("captures a one-off's actual Project and rolls back resume if saving its choice fails", async () => {
    const target = { daemonReference: "host", projectId: "actual-project", projectRoot: "/actual" };
    const f = fixture({ resolveAgentTarget: async () => target });
    await f.lifecycle.handle({ name: "quick", value: "Inspect this" }, f.context);
    expect(f.attach).toHaveBeenCalledWith(
      expect.objectContaining({ route: expect.objectContaining({ placement: target }) }),
      expect.objectContaining({ accessTarget: target }),
    );
    const g = fixture({
      synchronizePlacement: async () => {
        throw new Error("Could not save selection");
      },
    });
    await g.seed();
    expect(
      (await g.lifecycle.handle({ name: "resume", value: g.target.id }, g.context))?.handled,
    ).toBe(false);
    expect((await g.bound())?.agentId).toBe(g.old.id);
    expect(g.cancelAgent).not.toHaveBeenCalled();
  });

  it("steers the running turn", async () => {
    const f = fixture();
    await f.lifecycle.handle({ name: "steer", value: "change direction" }, f.context);
    expect(f.sendAgentMessage).toHaveBeenCalledWith(f.old.id, "change direction", {
      steer: true,
      source: f.context.message,
    });
  });
});

describe("Project and Workspace commands", () => {
  function placementFixture() {
    const f = fixture();
    const projects = Array.from({ length: 24 }, (_, i) => ({
      projectId: `prj_${i.toString().padStart(2, "0")}`,
      projectDisplayName: `Payments ${i.toString().padStart(2, "0")}`,
      projectRootPath: `/repo/${i}`,
      projectKind: "git",
    }));
    const workspaces = Array.from({ length: 24 }, (_, i) => ({
      ...projects[0]!,
      id: `wks_${i.toString().padStart(2, "0")}`,
      name: `Login ${i}`,
      workspaceDirectory: `/worktrees/${i}`,
      workspaceKind: i % 2 ? "local_checkout" : "worktree",
      branch: `fix/login-${i}`,
      activityAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    }));
    const policy = { create: true, grant: true, workspace: true };
    const base: import("./daemon/types.js").CreateAgentConfig = {
      provider: "codex",
      cwd: "/repo/0",
      projectId: "prj_00",
      modeId: "default",
    };
    const daemon: DaemonConnection = {
      ...f.daemon,
      ...configurationDaemonStub(),
      getServerInfo: () => ({
        serverId: "host",
        hostname: "Dev Host",
        features: { workspaceMultiplicity: true },
      }),
      listProjects: async () => [
        ...projects,
        { ...projects[0]!, projectId: "secret", projectDisplayName: "Hidden" },
      ],
      listWorkspaces: async () => workspaces,
      getAgentProject: async (agent) => {
        const workspace = workspaces.find((w) => w.id === agent.workspaceId);
        return projects.find((p) => p.projectId === workspace?.projectId);
      },
      listBranches: vi.fn(async () => [
        { name: "main", committerDate: 0, hasLocal: true, hasRemote: true },
      ]),
      createWorkspace: f.createWorkspace,
    };
    const plane = {
      organizationId: "lifecycle",
      resolveAgentAccessTarget: () => ({
        daemonReference: "host",
        projectId: "prj_00",
        projectRoot: "/repo/0",
      }),
      commandAccess: {
        authorizeChannelPrivilege: vi.fn(
          async (request: { projectId?: string; privilege: string }) => ({
            allowed:
              request.projectId !== "secret" &&
              (request.privilege !== "agent.create" || policy.create) &&
              (request.privilege !== "workspace.create" || policy.workspace),
          }),
        ),
        resolveChannelAgentConfigurations: async () => ({
          unrestricted: policy.grant,
          agentConfigurations: [],
        }),
      },
      resolveAgentSpec: () => ({ ...base }),
    } as unknown as ChannelPlaneDeps;
    const dispatcher = new ChannelCommandDispatcher({
      plane,
      daemon,
      store,
      lifecycle: f.lifecycle,
      pendingApprovals: () => 0,
      dispatchPrompt: async () => true,
    });
    const commands = new ChannelPlacementCommands({
      plane,
      daemon,
      store,
      baseConfig: async () => ({ ...base }),
      authorizeConfiguration: (input) => dispatcher.authorizeConfiguration(input),
    });
    const key = placementSelectionKey("lifecycle", f.context);
    return { ...f, plane, daemon, projects, workspaces, policy, base, dispatcher, commands, key };
  }
  function gitFixture() {
    const f = placementFixture();
    const commit = {
      hash: "a".repeat(40),
      committedAt: "2026-10-12T07:00:00Z",
      author: "QA Author",
      subject: "Fix login",
    };
    f.daemon.getServerInfo = () => ({
      serverId: "host",
      hostname: "Dev Host",
      features: { workspaceMultiplicity: true, projectGitCommands: true },
    });
    const trees = Array.from({ length: 12 }, (_, i) => ({
      path: `/worktrees/${i}`,
      branch: `fix/login-${i}`,
      head: commit.hash,
      bare: false,
      detached: false,
      locked: false,
      prunable: false,
      commit,
    }));
    trees.push({ ...trees[0]!, path: "/outside/unregistered", branch: "outside" });
    f.daemon.listGitWorktrees = vi.fn(async () => trees);
    f.daemon.inspectGitWorktree = vi.fn(async (_projectId, path) => ({
      path,
      commit,
      status: { tracked: 0, untracked: 7, staged: 0, unstaged: 0, conflicts: 0 },
    }));
    f.daemon.listGitBranches = vi.fn(async () => [
      { name: "main", source: "local" as const, commit, committerDate: 1 },
      {
        name: "origin/main",
        source: "remote" as const,
        remote: "origin",
        commit,
        committerDate: 2,
      },
      {
        name: "upstream/main",
        source: "remote" as const,
        remote: "upstream",
        commit,
        committerDate: 3,
      },
    ]);
    f.daemon.fetchGitRemote = vi.fn(async () => "2026-10-12T07:00:00Z");
    return { ...f, trees, commit };
  }
  it("lists all remote namespaces with commit hash, date and author", async () => {
    const f = gitFixture();
    const reply = await f.commands.run({ name: "branch", value: "list" }, f.context);
    expect(reply).toContain("upstream/main — remote");
    expect(reply).toContain("origin/main — remote");
    expect(reply).toContain("main — local");
    expect(reply).toContain("`aaaaaaaa` · 2026-10-12 07:00 UTC · QA Author");
    const search = await f.commands.run({ name: "branch", value: "search upstream/" }, f.context);
    expect(search).toContain("1 results");
    expect(search).not.toContain("origin/main");
  });
  it("uses the Route's existing Workspace before a session and hides inaccessible current worktrees", async () => {
    const f = gitFixture();
    const before = { ...f.context, agentId: undefined };
    f.base.workspaceId = "wks_05";
    expect(await f.commands.run({ name: "worktree" }, before)).toContain(
      "Workspace: Login 5 (wks_05)",
    );
    vi.mocked(f.daemon.listGitWorktrees!).mockClear();
    Object.assign(f.old, { projectId: "secret", cwd: "/private/secret" });
    await expect(f.commands.run({ name: "worktree" }, f.context)).rejects.toThrow(
      "do not have access",
    );
    expect(f.daemon.listGitWorktrees).not.toHaveBeenCalled();
  });
  it("shows current worktree status and commit without changing placement or creating sessions", async () => {
    const f = gitFixture();
    Object.assign(f.old, { projectId: "prj_00", workspaceId: "wks_05", cwd: "/worktrees/5" });
    const reply = await f.commands.run({ name: "worktree" }, f.context);
    expect(reply).toContain("Workspace: Login 5 (wks_05)");
    expect(reply).toContain("Status: 7 untracked files; no tracked changes");
    expect(reply).toContain("Branch: `fix/login-5`");
    expect(reply).toContain("QA Author");
    expect(await store.access.findConversationSelection(f.key)).toBeUndefined();
    expect(f.createAgent).not.toHaveBeenCalled();
    expect(f.createWorkspace).not.toHaveBeenCalled();
    const branch = await f.commands.run({ name: "branch" }, f.context);
    expect(branch).toContain("Commit:");
    expect(branch).toContain("QA Author");
  });
  it("pages worktrees before inspecting status, including unregistered paths", async () => {
    const f = gitFixture();
    const reply = await f.commands.run(
      { name: "worktree", value: "search Login --page 2" },
      f.context,
    );
    expect(reply).toContain("Page 2/2 · 12 results");
    expect(f.daemon.inspectGitWorktree).toHaveBeenCalledTimes(2);
    vi.mocked(f.daemon.inspectGitWorktree!).mockClear();
    const external = await f.commands.run(
      { name: "worktree", value: "show /outside/unregistered" },
      f.context,
    );
    expect(external).toContain("Workspace: not registered");
    expect(external).toContain("Path: `/outside/unregistered`");
    expect(f.createWorkspace).not.toHaveBeenCalled();
    await expect(
      f.commands.run({ name: "worktree", value: "show /private/foreign" }, f.context),
    ).rejects.toThrow("unavailable in this Project");
    expect(f.daemon.inspectGitWorktree).toHaveBeenCalledTimes(1);
  });
  it("requires command authority for fetch and consumes replayed deliveries once", async () => {
    const f = gitFixture();
    const authorize = f.plane.commandAccess!.authorizeChannelPrivilege;
    f.plane.commandAccess!.authorizeChannelPrivilege = async (request) =>
      request.privilege === "approval.command"
        ? { allowed: false, reason: "No command permission" }
        : authorize(request);
    await expect(f.commands.run({ name: "branch", value: "fetch" }, f.context)).rejects.toThrow(
      "approval.command",
    );
    expect(f.daemon.fetchGitRemote).not.toHaveBeenCalled();
    f.plane.commandAccess!.authorizeChannelPrivilege = authorize;
    const context = {
      ...f.context,
      message: { ...f.context.message, externalMessageId: "fetch-once" },
    };
    expect((await f.dispatcher.handle({ name: "branch", value: '"fetch"' }, context)).handled).toBe(
      true,
    );
    expect((await f.dispatcher.handle({ name: "branch", value: "fetch" }, context)).handled).toBe(
      true,
    );
    expect(f.daemon.fetchGitRemote).toHaveBeenCalledTimes(1);
    expect(f.daemon.fetchGitRemote).toHaveBeenCalledWith("prj_00", "origin", context.message);
    expect(f.createAgent).not.toHaveBeenCalled();
  });
  it("gates /worktree on Host capability and the existing commands switch", async () => {
    const f = placementFixture();
    await expect(f.commands.run({ name: "worktree", value: "list" }, f.context)).rejects.toThrow(
      "Update this Host",
    );
    const disabled = {
      ...f.context.route,
      defaults: { ...f.context.route.defaults, workspace: { commands: false } },
    };
    await expect(
      f.commands.run(
        { name: "worktree", value: "list" },
        { ...f.context, route: disabled, account: { ...f.context.account, routes: [disabled] } },
      ),
    ).rejects.toThrow("disabled");
  });
  it("filters permissions before pagination, preserves the search and rejects invalid pages", async () => {
    const f = placementFixture();
    const reply = await f.commands.run(
      { name: "project", value: "search Payments --page 2" },
      f.context,
    );
    expect(reply).toContain("Page 2/3 · 24 results");
    expect(reply).toContain("11. Payments 10");
    expect(reply).not.toContain("Payments 00 —");
    expect(reply).not.toContain("Hidden");
    expect(reply).toContain('Next: `/project search "Payments" --page 3`');
    await expect(
      f.commands.run({ name: "project", value: "list --page 4" }, f.context),
    ).rejects.toThrow("Page 4");
    await expect(
      f.commands.run({ name: "project", value: "list --page 0" }, f.context),
    ).rejects.toThrow("positive integer");
    expect(
      await f.commands.run({ name: "project", value: "search no-match" }, f.context),
    ).toContain("0 results");
  });
  it.each(["search slash", 'search "SLASH"', "search slash qa"])(
    "searches visible Project names and IDs, without matching shared roots: %s",
    async (value) => {
      const f = placementFixture();
      f.projects.forEach((project, i) => {
        project.projectRootPath = `/slash-test/project-${i}`;
      });
      f.projects[0]!.projectDisplayName = "Slash QA A";
      f.projects[1]!.projectDisplayName = "Slash QA B";

      const reply = await f.commands.run({ name: "project", value }, f.context);

      expect(reply).toContain("Page 1/1 · 2 results");
      expect(reply).toContain("Slash QA A — prj_00");
      expect(reply).toContain("Slash QA B — prj_01");
      expect(reply).not.toContain("Payments");
      expect(reply).not.toContain("Next:");
    },
  );
  it("finds a Project by ID and returns no matches for root-only terms", async () => {
    const f = placementFixture();
    const reply = await f.commands.run({ name: "project", value: "search PRJ_07" }, f.context);
    expect(reply).toContain("Page 1/1 · 1 results");
    expect(reply).toContain("Payments 07 — prj_07");
    expect(await f.commands.run({ name: "project", value: 'search "/repo"' }, f.context)).toContain(
      "0 results",
    );
  });
  it.each(["/shared/project-seven/", "C:\\shared\\project-seven\\"])(
    "searches the last folder name across Host platforms: %s",
    async (root) => {
      const f = placementFixture();
      f.projects[7]!.projectRootPath = root;
      const reply = await f.commands.run(
        { name: "project", value: "search PROJECT-SEVEN" },
        f.context,
      );
      expect(reply).toContain("1 results");
      expect(reply).toContain("Payments 07 — prj_07");
      expect(reply).toContain("Folder: `project-seven`");
      expect(
        await f.commands.run({ name: "project", value: "search shared" }, f.context),
      ).toContain("0 results");
    },
  );
  it.each(["project", "workspace", "branch"] as const)(
    "shows named current and next locations without listing or changing state: /%s",
    async (name) => {
      const f = placementFixture();
      Object.assign(f.old, { projectId: "prj_00", workspaceId: "wks_05", cwd: "/worktrees/5" });
      await f.commands.run({ name: "project", value: "prj_01" }, f.context);
      const before = await store.access.findConversationSelection(f.key);
      f.policy.create = false;

      const reply = await f.commands.run({ name }, f.context);

      expect(reply).toContain("Host: Dev Host (host)");
      expect(reply).toContain("**Current session**\nProject: Payments 00 (prj_00)");
      expect(reply).toContain("Workspace: Login 5 (wks_05)");
      expect(reply).toContain("Branch: `fix/login-5`");
      expect(reply).toContain("Path: `/worktrees/5`");
      expect(reply).toContain("**Next session** — selected\nProject: Payments 01 (prj_01)");
      expect(reply).toContain("Workspace: new; created when the next session starts");
      expect(reply).not.toContain("results ·");
      expect(await store.access.findConversationSelection(f.key)).toEqual(before);
      expect(f.createWorkspace).not.toHaveBeenCalled();
      expect(f.createAgent).not.toHaveBeenCalled();
    },
  );
  it("shows the Route default before a session exists without fabricating Workspace metadata", async () => {
    const f = placementFixture();
    const reply = await f.commands.run({ name: "workspace" }, { ...f.context, agentId: undefined });
    expect(reply).toContain("**Current session**\nNone.");
    expect(reply).toContain("**Next session** — Route default\nProject: Payments 00 (prj_00)");
    expect(reply).toContain("Workspace: new; created when the next session starts");
    expect(reply).not.toContain("Workspace: Login");
    expect(f.createWorkspace).not.toHaveBeenCalled();
  });
  it("hides current Workspace metadata for a Project the caller cannot access", async () => {
    const f = placementFixture();
    Object.assign(f.old, {
      projectId: "secret",
      workspaceId: "secret-workspace",
      cwd: "/private/hidden",
    });
    const read = vi.fn(async () => f.workspaces);
    f.daemon.listWorkspaces = read;
    const reply = await f.commands.run({ name: "project" }, f.context);
    expect(reply).toContain("Location unavailable or you do not have access.");
    expect(reply).not.toContain("secret");
    expect(reply).not.toContain("/private");
    expect(read).not.toHaveBeenCalled();
  });
  it("keeps the live location readable when a staged Route selection expires", async () => {
    const f = placementFixture();
    Object.assign(f.old, { projectId: "prj_00", workspaceId: "wks_05", cwd: "/worktrees/5" });
    await f.commands.run({ name: "project", value: "prj_01" }, f.context);
    const changed = { ...f.context.route, where: { ...f.context.route.where, dm: true } };
    const reply = await f.commands.run(
      { name: "workspace" },
      { ...f.context, route: changed, account: { ...f.context.account, routes: [changed] } },
    );
    expect(reply).toContain("Workspace: Login 5 (wks_05)");
    expect(reply).toContain("Selection expired");
    expect(reply).not.toContain("Project: Payments 01");
  });
  it("preserves a successful selection if an optional detail read fails", async () => {
    const f = placementFixture();
    f.daemon.listAgents = async () => {
      throw new Error("Host read interrupted");
    };
    const reply = await f.commands.run({ name: "project", value: "prj_01" }, f.context);
    expect(reply).toContain("Selected Project: Payments 01");
    expect(reply).toContain("Location details unavailable");
    expect(
      (await store.access.findConversationSelection(f.key))?.selectedPlacement?.projectId,
    ).toBe("prj_01");
  });
  it("keeps bare configuration reads on the bound provider when a different provider is staged", async () => {
    const f = placementFixture();
    f.old.model = "live-model";
    await store.access.setConversationSelection(f.key, {
      selectedProvider: "claude",
      selectedModel: "next-model",
      selectedBy: f.context.message.senderIdentity,
    });
    const before = await store.access.findConversationSelection(f.key);
    const catalog = vi.fn(f.daemon.listProviderModels);
    f.daemon.listProviderModels = catalog;
    const result = await f.dispatcher.handle({ name: "model" }, f.context);
    expect(result.handled).toBe(true);
    const reply = vi.mocked(f.context.post).mock.calls.at(-1)?.[0];
    expect(reply).toContain("Current session");
    expect(reply).toContain("Model: live-model");
    expect(reply).toContain("**Next session**");
    expect(reply).toContain("Model: next-model");
    expect(reply).not.toContain("Available model");
    expect(catalog).not.toHaveBeenCalled();
    expect(await store.access.findConversationSelection(f.key)).toEqual(before);
  });
  it.each([0, 10, 11])("limits discovery to 10 rows at the %i-result boundary", async (count) => {
    const f = placementFixture();
    f.projects.splice(count);
    const reply = await f.commands.run({ name: "project", value: "list" }, f.context);
    expect(reply).toContain(`${count} results`);
    expect(reply.split("\n").filter((line) => /^\d+\. /.test(line))).toHaveLength(
      Math.min(10, count),
    );
    expect(reply.includes("Next:")).toBe(count > 10);
  });

  it("uses Workspace activity and branch search rather than alphabetical or metadata update order", async () => {
    const f = placementFixture();
    const reply = await f.commands.run(
      { name: "workspace", value: "search fix/login --page 2" },
      f.context,
    );
    expect(reply).toContain("11. Login 13 — wks_13");
    expect(reply).not.toContain("Login 23 —");
    expect(
      await f.commands.run({ name: "workspace", value: "list --worktree" }, f.context),
    ).toContain("12 results");
    await expect(f.commands.run({ name: "branch", value: "list" }, f.context)).rejects.toThrow(
      "Update this Host",
    );
  });
  it("searches Workspace leaf folders and shows full paths with named Project and Host context", async () => {
    const f = placementFixture();
    f.workspaces[7]!.workspaceDirectory = "/shared/workspace-seven/";
    const reply = await f.commands.run(
      { name: "workspace", value: "search workspace-seven" },
      f.context,
    );
    expect(reply).toContain("1 results");
    expect(reply).toContain("Login 7 — wks_07");
    expect(reply).toContain("Host: Dev Host (host)");
    expect(reply).toContain("Project: Payments 00 (prj_00)");
    expect(reply).toContain("Branch: `fix/login-7`");
    expect(reply).toContain("Path: `/shared/workspace-seven/`");
    expect(
      await f.commands.run({ name: "workspace", value: "search shared" }, f.context),
    ).toContain("0 results");
  });
  it("keeps names, branches and full Host paths literal for channel renderers", async () => {
    const f = placementFixture();
    f.projects[0]!.projectDisplayName = "QA [Dev]";
    Object.assign(f.workspaces[0]!, {
      name: "Login *QA*",
      branch: "fix/login_one_two",
      workspaceDirectory: "C:\\Users\\qa_one\\repo[1] <draft>",
    });
    const reply = await f.commands.run({ name: "workspace", value: "show wks_00" }, f.context);
    expect(reply).toContain("Project: QA \\[Dev\\]");
    expect(reply).toContain("Workspace: Login \\*QA\\*");
    expect(reply).toContain("Branch: `fix/login_one_two`");
    expect(reply).toContain("Path: `C:\\Users\\qa_one\\repo[1] <draft>`");
    expect(await store.access.findConversationSelection(f.key)).toBeUndefined();
  });
  it("hides a revoked next Project and does not read its Workspace metadata", async () => {
    const f = placementFixture();
    await f.commands.run({ name: "workspace", value: "wks_05" }, f.context);
    const authorize = f.plane.commandAccess!.authorizeChannelPrivilege;
    f.plane.commandAccess!.authorizeChannelPrivilege = async (request) =>
      request.projectId === "prj_00"
        ? { allowed: false, reason: "Project access revoked" }
        : authorize(request);
    const read = vi.fn(async () => f.workspaces);
    f.daemon.listWorkspaces = read;
    const reply = await f.commands.run({ name: "workspace" }, f.context);
    expect(reply).toContain("Location unavailable or you do not have access.");
    expect(reply).not.toContain("Payments 00");
    expect(reply).not.toContain("Login 5");
    expect(reply).not.toContain("/worktrees");
    expect(read).not.toHaveBeenCalled();
  });
  it("stages before the first session, selects existing Workspaces and isolates thread choices", async () => {
    const f = placementFixture();
    const context = { ...f.context, agentId: undefined };
    expect(await f.commands.run({ name: "project", value: "prj_00" }, context)).toContain(
      "next session in this thread",
    );
    await f.commands.run({ name: "workspace", value: "wks_03" }, context);
    expect((await store.access.findConversationSelection(f.key))?.selectedPlacement).toMatchObject({
      projectId: "prj_00",
      workspaceId: "wks_03",
    });
    expect(await f.dispatcher.resolveConfig(context)).toMatchObject({
      cwd: "/worktrees/3",
      workspaceId: "wks_03",
      projectId: "prj_00",
    });
    expect(
      await store.access.findConversationSelection({ ...f.key, externalThreadId: "other" }),
    ).toBeUndefined();
    await f.commands.run({ name: "workspace", value: "clear" }, context);
    expect(
      (await store.access.findConversationSelection(f.key))?.selectedPlacement?.workspaceId,
    ).toBeUndefined();
    await f.commands.run({ name: "project", value: "prj_01" }, context);
    expect((await store.access.findConversationSelection(f.key))?.selectedPlacement).toMatchObject({
      projectId: "prj_01",
    });
    expect(f.createAgent).not.toHaveBeenCalled();
    expect(f.cancelAgent).not.toHaveBeenCalled();
  });
  it("rejects agent.create and configuration-grant failures, and rechecks revoked grants before use", async () => {
    const f = placementFixture();
    f.policy.create = false;
    await expect(f.commands.run({ name: "project", value: "prj_01" }, f.context)).rejects.toThrow(
      "agent.create",
    );
    expect(await store.access.findConversationSelection(f.key)).toBeUndefined();
    f.policy.create = true;
    f.policy.grant = false;
    await expect(f.commands.run({ name: "project", value: "prj_01" }, f.context)).rejects.toThrow();
    f.policy.grant = true;
    await f.commands.run({ name: "project", value: "prj_01" }, f.context);
    f.policy.create = false;
    await expect(f.dispatcher.resolveConfig(f.context)).rejects.toThrow("agent.create");
  });
  it("expires a choice after Route/Host changes and lets the kill switch ignore staged placement", async () => {
    const f = placementFixture();
    await f.commands.run({ name: "project", value: "prj_01" }, f.context);
    const modified = { ...route, defaults: { ...defaults, requireMention: false } };
    await expect(
      f.dispatcher.resolveConfig({
        ...f.context,
        route: modified,
        account: { ...account, routes: [modified] },
      }),
    ).rejects.toThrow("expired");
    const disabled = { ...route, defaults: { ...defaults, workspace: { commands: false } } };
    const context = { ...f.context, route: disabled, account: { ...account, routes: [disabled] } };
    expect(await f.dispatcher.resolveConfig(context)).toMatchObject({
      cwd: "/repo/0",
      projectId: "prj_00",
    });
    await expect(f.commands.run({ name: "workspace", value: "list" }, context)).rejects.toThrow(
      "disabled",
    );
  });
  it("creates immediately with quoted title, explicit branch and a stable daemon idempotency key", async () => {
    const f = placementFixture();
    const context = {
      ...f.context,
      message: { ...f.context.message, externalMessageId: "same-create" },
    };
    const command = {
      name: "workspace" as const,
      value: 'new main --branch fix/login --name "Fix login"',
    };
    expect(await f.commands.run(command, context)).toContain(
      "No Agent session has been created yet",
    );
    await f.commands.run(command, context);
    expect(f.createWorkspace).toHaveBeenLastCalledWith(
      {
        cwd: "/repo/0",
        projectId: "prj_00",
        kind: "worktree",
        baseRef: "main",
        branchName: "fix/login",
        title: "Fix login",
        idempotencyKey: expect.any(String),
      },
      { source: context.message },
    );
    expect(f.createWorkspace.mock.calls[0]?.[0]?.idempotencyKey).toBe(
      f.createWorkspace.mock.calls[1]?.[0]?.idempotencyKey,
    );
    expect(f.createAgent).not.toHaveBeenCalled();
    await expect(
      f.commands.run({ name: "workspace", value: "new main --local" }, context),
    ).rejects.toThrow("omit base");
    await f.commands.run({ name: "workspace", value: 'new --local --name "Local work"' }, context);
    expect(f.createWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "directory", title: "Local work" }),
      expect.anything(),
    );
  });
  it("keeps live model configuration usable when the next Project loses create access", async () => {
    const f = placementFixture();
    await f.commands.run({ name: "project", value: "prj_01" }, f.context);
    f.policy.create = false;
    const models = vi.fn(f.daemon.listProviderModels);
    f.daemon.listProviderModels = models;
    const result = await f.dispatcher.handle({ name: "model", value: "list" }, f.context);
    expect(result.handled).toBe(true);
    expect(models).toHaveBeenCalledWith("codex", "/repo");
  });
  it("checks resume against the actual session Project and synchronizes its next placement", async () => {
    const f = placementFixture();
    f.workspaces[1] = { ...f.workspaces[1]!, ...f.projects[1]! };
    const target = { ...f.target, workspaceId: "wks_01", modeId: "default" };
    await f.commands.run({ name: "project", value: "prj_02" }, f.context);
    const authorize = f.plane.commandAccess!.authorizeChannelPrivilege;
    f.plane.commandAccess!.authorizeChannelPrivilege = async (request) => {
      if (request.projectId === "prj_00" && request.privilege === "agent.create")
        return { allowed: false, reason: "No create access to the Route default" };
      return authorize(request);
    };
    expect(await f.dispatcher.authorizeResume(target, f.context)).toBe(true);
    await f.dispatcher.synchronizePlacement(target, f.context);
    expect((await store.access.findConversationSelection(f.key))?.selectedPlacement).toMatchObject({
      projectId: "prj_01",
      workspaceId: "wks_01",
    });
  });

  it("refuses resume/fork outside the actual Project even when the snapshot claims the Route Project", async () => {
    const f = placementFixture();
    const source = { ...f.old, projectId: "prj_00", workspaceId: "wks_01", modeId: "default" };
    f.workspaces[1] = { ...f.workspaces[1]!, ...f.projects[1]! };
    f.daemon.listAgents = async () => [source];
    await f.commands.run({ name: "project", value: "prj_00" }, f.context);
    const authorize = f.plane.commandAccess!.authorizeChannelPrivilege;
    f.plane.commandAccess!.authorizeChannelPrivilege = async (request) =>
      request.projectId === "prj_01"
        ? { allowed: false, reason: "Project denied" }
        : authorize(request);
    expect(await f.dispatcher.authorizeResume(source, f.context)).toBe(false);
    await expect(f.dispatcher.authorizeFork(f.context)).rejects.toThrow("agent.interact");
    f.daemon.getAgentProject = async () => undefined;
    expect(await f.dispatcher.authorizeResume(source, f.context)).toBe(false);
    await expect(f.dispatcher.agentTarget(source, f.context)).rejects.toThrow("unavailable");
    expect(f.cancelAgent).not.toHaveBeenCalled();
    expect(f.createAgent).not.toHaveBeenCalled();
  });

  it("keeps /side in the confirmed source Project despite a different next-session choice", async () => {
    const f = placementFixture();
    f.workspaces[1] = { ...f.workspaces[1]!, ...f.projects[1]! };
    const source = { ...f.old, workspaceId: "wks_01", cwd: "/worktrees/1", modeId: "default" };
    f.daemon.listAgents = async () => [source];
    await f.commands.run({ name: "project", value: "prj_02" }, f.context);
    expect(await f.dispatcher.resolveSourceConfig(f.context)).toMatchObject({
      projectId: "prj_01",
      workspaceId: "wks_01",
      cwd: "/worktrees/1",
    });
    const authorize = f.plane.commandAccess!.authorizeChannelPrivilege;
    f.plane.commandAccess!.authorizeChannelPrivilege = async (request) =>
      request.projectId === "prj_01"
        ? { allowed: false, reason: "Source Project denied" }
        : authorize(request);
    await expect(f.dispatcher.resolveSourceConfig(f.context)).rejects.toThrow("project.use");
    expect(f.createAgent).not.toHaveBeenCalled();
  });

  it("does not read or overwrite next placement when the commands feature is disabled", async () => {
    const f = placementFixture();
    await f.commands.run({ name: "workspace", value: "wks_01" }, f.context);
    const previous = (await store.access.findConversationSelection(f.key))!.selectedPlacement;
    const lookup = vi.fn(f.daemon.getAgentProject);
    f.daemon.getAgentProject = lookup;
    const disabled = { ...route, defaults: { ...defaults, workspace: { commands: false } } };
    await f.dispatcher.synchronizePlacement(f.target, {
      ...f.context,
      route: disabled,
      account: { ...account, routes: [disabled] },
    });
    expect(lookup).not.toHaveBeenCalled();
    expect((await store.access.findConversationSelection(f.key))?.selectedPlacement).toEqual(
      previous,
    );
  });

  it("can create a local Workspace explicitly even if the Route defaults to a worktree", async () => {
    const f = placementFixture();
    f.base.worktree = { mode: "branch-off", newBranch: "generated" };
    f.projects[0]!.projectKind = "directory";
    await expect(f.commands.run({ name: "project", value: "prj_00" }, f.context)).rejects.toThrow(
      "no Git repository",
    );
    await f.commands.run({ name: "workspace", value: "new --local" }, f.context);
    expect(f.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "directory", projectId: "prj_00" }),
      expect.anything(),
    );
  });

  it("requires worktree creation access at selection and rechecks it before /new clears the current binding", async () => {
    const f = placementFixture();
    f.base.worktree = { mode: "branch-off", newBranch: "generated" };
    f.policy.workspace = false;
    await expect(f.commands.run({ name: "project", value: "prj_01" }, f.context)).rejects.toThrow(
      "workspace.create",
    );
    expect(await store.access.findConversationSelection(f.key)).toBeUndefined();
    f.policy.workspace = true;
    await f.commands.run({ name: "project", value: "prj_01" }, f.context);
    expect((await f.dispatcher.resolveConfig(f.context)).worktree).toEqual(f.base.worktree);
    f.policy.workspace = false;
    const lifecycle = fixture({ resolveConfig: () => f.dispatcher.resolveConfig(f.context) });
    await lifecycle.seed();
    expect((await lifecycle.lifecycle.handle({ name: "new" }, lifecycle.context))?.handled).toBe(
      false,
    );
    expect(lifecycle.cancelAgent).not.toHaveBeenCalled();
    expect((await lifecycle.bound())?.agentId).toBe(lifecycle.old.id);
    // Joining an existing Workspace performs no worktree creation.
    f.workspaces[1] = { ...f.workspaces[1]!, ...f.projects[1]! };
    await f.commands.run({ name: "workspace", value: "wks_01" }, f.context);
    const selected = await f.dispatcher.resolveConfig(f.context);
    expect(selected.workspaceId).toBe("wks_01");
    expect(selected.worktree).toBeUndefined();
  });

  it("keeps placement across model-default changes but rechecks the changed configuration grant", async () => {
    const f = placementFixture();
    await f.commands.run({ name: "workspace", value: "wks_01" }, f.context);
    const modified = { ...route, defaults: { ...defaults, agentControls: { provider: "codex" } } };
    const context = { ...f.context, route: modified, account: { ...account, routes: [modified] } };
    expect(placementRouteFingerprint(modified)).toBe(placementRouteFingerprint(route));
    expect(await f.dispatcher.resolveConfig(context)).toMatchObject({
      workspaceId: "wks_01",
      cwd: "/worktrees/1",
    });
    f.policy.grant = false;
    await expect(f.dispatcher.resolveConfig(context)).rejects.toThrow("AgentConfigurationGrant");
  });

  it("promotes configuration without clearing the Workspace and uses the new Route configuration afterwards", async () => {
    const f = placementFixture();
    await f.commands.run({ name: "workspace", value: "wks_01" }, f.context);
    await store.access.setConversationSelection(f.key, {
      selectedProvider: "claude",
      selectedModel: "default",
      selectedBy: "U1",
    });
    f.plane.commandAccess!.authorizeChannelAccountManagement = async () => ({
      membershipId: "m",
      userId: "u",
    });
    f.plane.routeDefaults = {
      promote: vi.fn(async (_target, controls) => ({
        status: "published" as const,
        agentControls: controls,
      })),
      undo: vi.fn(),
      setFollowUp: vi.fn(),
      apply: vi.fn(),
    };
    const previous = (await store.access.findConversationSelection(f.key))!.selectedPlacement;
    expect((await f.dispatcher.handle({ name: "promoteroutedefault" }, f.context)).handled).toBe(
      true,
    );
    expect(f.plane.routeDefaults!.promote).toHaveBeenCalled();
    expect(await store.access.findConversationSelection(f.key)).toMatchObject({
      selectedPlacement: previous,
      selectedProvider: null,
      selectedModel: null,
    });
    const modified = {
      ...route,
      defaults: { ...defaults, agentControls: { provider: "claude", model: "default" } },
    };
    const context = { ...f.context, route: modified, account: { ...account, routes: [modified] } };
    f.plane.resolveAgentSpec = () => ({ ...f.base, provider: "claude", model: "default" });
    expect(await f.dispatcher.resolveConfig(context)).toMatchObject({
      provider: "claude",
      model: "default",
      workspaceId: "wks_01",
      cwd: "/worktrees/1",
    });
  });

  it("requires an ID for duplicate names and supports show without selecting", async () => {
    const f = placementFixture();
    f.workspaces[1]!.name = f.workspaces[0]!.name;
    await expect(
      f.commands.run({ name: "workspace", value: "Login 0" }, f.context),
    ).rejects.toThrow("Select by ID");
    expect(await f.commands.run({ name: "workspace", value: "show wks_01" }, f.context)).toContain(
      "Path: `/worktrees/1`",
    );
    expect(await store.access.findConversationSelection(f.key)).toBeUndefined();
  });
  it("validates /new before releasing its source and source authority before extracting fork context", async () => {
    const rejected = vi.fn(async () => {
      throw new Error("selected Project revoked");
    });
    const f = fixture({ resolveConfig: rejected });
    await f.seed();
    const result = await f.lifecycle.handle({ name: "new" }, f.context);
    expect(result?.handled).toBe(false);
    expect(f.cancelAgent).not.toHaveBeenCalled();
    expect((await f.bound())?.agentId).toBe(f.old.id);
    const g = fixture({
      authorizeFork: async () => {
        throw new Error("source denied");
      },
    });
    await g.lifecycle.handle({ name: "fork" }, g.context);
    expect(g.daemon.buildAgentForkContext).not.toHaveBeenCalled();
    expect(g.createAgent).not.toHaveBeenCalled();
  });
});
