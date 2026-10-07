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
  const createWorkspace = vi.fn(async () => ({ workspaceId: "workspace-quick" }));
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
    store,
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
  it("new clears old binding even when cancelAgent rejects", async () => {
    const f = fixture();
    f.cancelAgent.mockRejectedValueOnce(new Error("Agent 123 not found"));
    await f.seed();
    const outcome = await f.lifecycle.handle({ name: "new" }, f.context);
    expect(outcome?.handled).toBe(true);
    expect(await f.bound()).toBeUndefined();
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
    expect(issueCapability).toHaveBeenCalledWith(toolContext);
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
  it("steers the running turn", async () => {
    const f = fixture();
    await f.lifecycle.handle({ name: "steer", value: "change direction" }, f.context);
    expect(f.sendAgentMessage).toHaveBeenCalledWith(f.old.id, "change direction", {
      steer: true,
      source: f.context.message,
    });
  });
  it("handoff creates a new forum topic, rebinds the agent, and posts link", async () => {
    const createTopic = vi.fn(async (params) => ({
      topicId: 77,
      name: params.name,
      chatId: params.chatId,
    }));
    const postToTopic = vi.fn(async () => true);
    const f = fixture({ createTopic, postToTopic });
    await f.seed();

    const telegramContext = {
      ...f.context,
      account: { ...f.context.account, channel: "telegram" },
      message: {
        ...f.context.message,
        channel: "telegram" as const,
        conversation: {
          kind: "channel" as const,
          id: "-1001234567890",
          rootConversationId: "-1001234567890",
          threadId: null,
        },
      },
    };

    const outcome = await f.lifecycle.handle(
      { name: "handoff", value: "Investigate Auth" },
      telegramContext,
    );
    expect(outcome?.handled).toBe(true);
    expect(createTopic).toHaveBeenCalledWith({
      channel: "telegram",
      accountId: "work",
      chatId: "-1001234567890",
      name: "Investigate Auth",
    });
    expect(postToTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        chatId: "-1001234567890",
        threadId: "77",
      }),
    );

    // Old binding released
    expect(await f.bound()).toBeUndefined();

    // New binding exists for the new topic
    const newBound = await f.store.findThreadBinding("lifecycle", "work", "-1001234567890", "77");
    expect(newBound?.agentId).toBe(f.old.id);
    expect(newBound?.status).toBe("bound");

    // Replied with link to new topic
    expect(outcome?.detail).toContain("https://t.me/c/1234567890/77");
    expect(outcome?.detail).toContain("Investigate Auth");
  });

  it("handoff uses the agent title when no prompt is provided", async () => {
    const createTopic = vi.fn(async (params) => ({
      topicId: 88,
      name: params.name,
      chatId: params.chatId,
    }));
    const f = fixture({ createTopic });
    f.old.title = "My Planned Work";
    await f.seed();

    const telegramContext = {
      ...f.context,
      account: { ...f.context.account, channel: "telegram" },
      message: {
        ...f.context.message,
        channel: "telegram" as const,
        conversation: {
          kind: "channel" as const,
          id: "-1001234567890",
          rootConversationId: "-1001234567890",
          threadId: null,
        },
      },
    };

    const outcome = await f.lifecycle.handle({ name: "handoff" }, telegramContext);
    expect(outcome?.handled).toBe(true);
    expect(createTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        name: f.old.title,
      }),
    );
    expect(outcome?.detail).toContain("https://t.me/c/1234567890/88");
  });

  it("handoff supports explicit target chat in prompt", async () => {
    const createTopic = vi.fn(async (params) => ({
      topicId: 99,
      name: params.name,
      chatId: params.chatId,
    }));
    const f = fixture({ createTopic });
    await f.seed();

    const outcome = await f.lifecycle.handle(
      { name: "handoff", value: "-1009876543210 Custom Topic" },
      f.context,
    );
    expect(outcome?.handled).toBe(true);
    expect(createTopic).toHaveBeenCalledWith({
      channel: "telegram",
      accountId: "default",
      chatId: "-1009876543210",
      name: "Custom Topic",
    });
    expect(outcome?.detail).toContain("https://t.me/c/9876543210/99");
  });

  it("handoff refuses when there is no bound session", async () => {
    const f = fixture();
    const outcome = await f.lifecycle.handle(
      { name: "handoff", value: "Topic" },
      { ...f.context, agentId: undefined },
    );
    expect(outcome?.handled).toBe(false);
    expect(f.context.post).toHaveBeenCalledWith(
      "No bound session to handoff. Start one with /new <message>.",
    );
  });

  it("handoff refuses when no forum group can be resolved", async () => {
    const createTopic = vi.fn();
    const f = fixture({ createTopic });
    await f.seed();

    const nonTelegramContext = {
      ...f.context,
      route: { ...route, where: { ...route.where, conversations: [] } },
      account: { ...f.context.account, channel: "slack", config: {} },
    };

    const outcome = await f.lifecycle.handle(
      { name: "handoff", value: "Topic" },
      nonTelegramContext,
    );
    expect(outcome?.handled).toBe(false);
    expect(f.context.post).toHaveBeenCalledWith(
      expect.stringContaining("No Telegram forum group specified or configured for handoff"),
    );
  });
});
