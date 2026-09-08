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
  match: { kind: "channel", ids: [] },
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
  fallback: { deny: true },
};
let fixtureId = 0;
function snapshot(id: string): AgentSnapshot {
  return {
    id,
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
  const old = snapshot(`old-${id}`),
    target = snapshot(`target-${id}`),
    created = snapshot(`new-${id}`);
  const order: string[] = [];
  const attachment = {
    type: "text" as const,
    mimeType: "text/plain" as const,
    text: "prior conversation",
    contextKind: "chat_history" as const,
  };
  const sendAgentMessage = vi.fn<DaemonConnection["sendAgentMessage"]>(async () => {
    order.push("send");
  });
  const cancelAgent = vi.fn(async () => undefined);
  const createAgent = vi.fn(async () => ({ agentId: created.id, agent: created }));
  const daemon = {
    listAgents: async () => [old, target],
    sendAgentMessage,
    cancelAgent,
    createAgent,
    getServerInfo: () => ({ features: { agentForkContext: true } }),
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
      title: "Channel /fork",
    });
    expect(f.sendAgentMessage).toHaveBeenCalledWith(f.created.id, "continue", {
      steer: true,
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
        title: `Channel /${name}`,
        autoArchive: true,
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
    const toolContext = {
      ...f.context,
      route: {
        ...route,
        defaults: { ...defaults, outbound: { path: "tool" as const, template: null } },
      },
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
    const toolContext = {
      ...f.context,
      route: {
        ...route,
        defaults: { ...defaults, outbound: { path: "tool" as const, template: null } },
      },
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
    expect(f.sendAgentMessage).toHaveBeenCalledWith(f.old.id, "change direction", { steer: true });
  });
});
