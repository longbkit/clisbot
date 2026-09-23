import { configurationDaemonStub } from "../daemon/test-support.js";
// COMPAT(clisbot-channels): targeted tests for the bindings engine (plan §4-S2).
// Drives the real ChannelStore (embedded PGlite, the same harness as
// db/channels.test.ts) against a fake in-memory DaemonConnection: first mention
// binds, follow-ups steer, orphan recovery re-binds without re-creating, and the
// mayTrigger / requireMention / idle-TTL admission gates hold.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ChannelStore } from "../../db/channels.js";
import { embeddedDatabaseRuntime } from "../../db/runtime/index.js";
import type { DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
} from "../config/compile.js";
import { toolActivityDefaults } from "../config/compile.js";
import type { AgentPermissionResponse, AgentSnapshot, CreateAgentConfig } from "../daemon/types.js";
import type { DaemonConnection } from "../daemon/client.js";
import { ManualClock } from "../plane/clock.js";
import type { InboundConversationDetail, InboundMessage, PlaneLogger } from "../plane/types.js";
import {
  BindingEngine,
  CHANNEL_EXECUTION_ID_LABEL,
  admitFollowUp,
  applyRouteAutoAccept,
  channelExecutionLabels,
  deriveBindingKey,
} from "./index.js";
import { PENDING_MARKER_TTL_MS } from "./pending-marker.js";
import { ChannelReplyCapabilityRegistry } from "../channel-reply-capabilities.js";
import { AgentRequestRefusedError } from "../daemon/agent-request-refusal.js";
import { channelMessageId } from "../daemon/session-operation.js";

const ORGANIZATION_ID = "channel-org";
const ACCOUNT_ID = "work";
const CONVERSATION = "C0APP";
const INITIATOR = "slack:U0ALICE";
const SILENT: PlaneLogger = { warn: () => undefined, info: () => undefined };

// --- Fixtures --------------------------------------------------------------

function snapshotOf(
  id: string,
  title: string | null,
  labels: Record<string, string> = {},
): AgentSnapshot {
  return {
    id,
    provider: "codex",
    cwd: "/tmp/repo",
    title,
    status: "idle",
    createdAt: "2026-08-25T00:00:00Z",
    updatedAt: "2026-08-25T00:00:00Z",
    labels,
  };
}

function makeFakeDaemon(listAgents: AgentSnapshot[] = []) {
  const created: {
    config: CreateAgentConfig;
    title: string | null;
    labels: Record<string, string>;
    workspaceId: string | null;
  }[] = [];
  const workspaces: { cwd: string; prompt: string | undefined }[] = [];
  const messages: { agentId: string; text: string; steer: boolean | null }[] = [];
  const responses: { agentId: string; requestId: string; response: AgentPermissionResponse }[] = [];
  const subscriptions: string[][] = [];
  const sources: (InboundMessage | undefined)[] = [];
  // The daemon's per-message receipt: a message id names one request, and a
  // replay that asks for anything else is refused for good.
  const receipts = new Map<string, string>();
  const takeReceipt: DaemonConnection["sendAgentMessage"] = async (agentId, text, options) => {
    if (options?.source === undefined) return;
    const key = options.messageId ?? channelMessageId(options.source);
    const request = JSON.stringify([
      agentId,
      text,
      options.steer === false ? "interrupt" : "steer",
    ]);
    const held = receipts.get(key);
    if (held !== undefined && held !== request) {
      throw new AgentRequestRefusedError("agent_request_key_conflict");
    }
    receipts.set(key, request);
  };
  let seq = 0;
  const daemon: DaemonConnection = {
    ...configurationDaemonStub(),
    // Workspace organization is on at the org floor, so the engine creates the
    // thread's first workspace through the daemon (A3).
    getServerInfo: () => ({ serverId: "test-daemon", features: { workspaceMultiplicity: true } }),
    createWorkspace: async (input) => {
      workspaces.push({ cwd: input.cwd, prompt: input.firstAgentContext?.prompt });
      return { workspaceId: `workspace-${workspaces.length - 1}` };
    },
    discovery: { url: "ws://127.0.0.1:6767/ws", source: "default-port" },
    waitForConnected: async () => undefined,
    createAgent: async (config, options) => {
      sources.push(options?.source);
      created.push({
        config,
        title: options?.title ?? null,
        labels: options?.labels ?? {},
        workspaceId: options?.workspaceId ?? null,
      });
      const id = `agent-${seq++}`;
      return {
        agentId: id,
        agent: snapshotOf(id, options?.title ?? null, options?.labels ?? {}),
      };
    },
    sendAgentMessage: async (agentId, text, options) => {
      await takeReceipt(agentId, text, options);
      sources.push(options?.source);
      messages.push({ agentId, text, steer: options?.steer ?? null });
    },
    cancelAgent: async () => undefined,
    respondToAgentPermission: async (agentId, requestId, response) => {
      responses.push({ agentId, requestId, response });
    },
    listAgents: async () => listAgents,
    setTimelineSubscription: async (agentIds) => {
      subscriptions.push([...agentIds]);
    },
    stop: () => undefined,
  };
  return {
    daemon,
    created,
    workspaces,
    messages,
    responses,
    subscriptions,
    sources,
    takeReceipt,
  };
}

const DEFAULTS = {
  requireMention: true,
  followUp: { mode: "auto" as const, ttlMinutes: 60 },
  bindingKey: "thread" as const,
  replyAnchor: "thread" as const,
  outbound: { path: "relay" as const, template: null },
  inbound: { reactionNotifications: "off" as const, editNotifications: "off" as const },
  sync: {
    finalAnswers: true,
    progress: { progressMessage: false, typingIndicator: false, messageReaction: "off" },
    toolCalls: toolActivityDefaults(false),
    threadLink: "final-only" as const,
    subagents: { finalAnswers: false, progress: false, toolCalls: false },
  },
};

function makeRoute(
  externalConversationId = CONVERSATION,
  overrides: {
    approval?: CompiledRoute["approval"];
    defaults?: Partial<CompiledRoute["defaults"]>;
  } = {},
): CompiledRoute {
  return {
    audienceRules: [],
    where: { dm: false, groups: [], conversations: [externalConversationId] },
    target: { kind: "agent", agent: "worker", environment: "repo", template: null },
    defaultRoles: ["interactor"],
    assignments: [
      { identities: [INITIATOR], roles: ["commandApprover"] },
      { identities: ["slack:U0BOB"], roles: ["commandApprover"] },
    ],
    defaults: { ...DEFAULTS, ...overrides.defaults },
    approval: overrides.approval ?? [
      { match: "file", mode: "auto-allow" },
      { match: "command", mode: "require", initiatorOnly: true },
      { match: "config", mode: "require" },
      { match: "*", mode: "auto-deny" },
    ],
  };
}

function makeAccount(route: CompiledRoute): CompiledChannelAccount {
  return {
    channel: "slack",
    accountId: ACCOUNT_ID,
    enabled: true,
    channelEnabled: true,
    connectionId: "connection-id",
    transport: {},
    config: {},
    defaultRoles: ["interactor"],
    assignments: [],
    defaults: DEFAULTS,
    approval: [],
    routes: [route],
  };
}

/** An account and the Route it serves, the same object on both sides. */
function routed(route: CompiledRoute = makeRoute()): [CompiledChannelAccount, CompiledRoute] {
  return [makeAccount(route), route];
}

function makeControlPlane(account: CompiledChannelAccount): ChannelControlPlane {
  return {
    enabled: true,
    channelEnabled: {},
    roles: {
      interactor: { grants: ["bot.interact"], deny: [], extends: [], closure: ["interactor"] },
      commandApprover: {
        grants: ["bot.interact", "approval.command"],
        deny: [],
        extends: [],
        closure: ["commandApprover"],
      },
    },
    users: {},
    identityOwners: {},
    assignments: [],
    defaults: DEFAULTS,
    approval: [],
    accounts: [account],
  };
}

const CHANNEL_CONVERSATION: InboundConversationDetail = {
  kind: "channel",
  id: CONVERSATION,
  rootConversationId: CONVERSATION,
  threadId: null,
};

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: "slack",
    accountId: ACCOUNT_ID,
    senderIdentity: INITIATOR,
    text: "start the build",
    mentionedBot: true,
    conversation: CHANNEL_CONVERSATION,
    ...overrides,
  };
}

function makeEngine(
  store: ChannelStore,
  daemon: DaemonConnection,
  clock = new ManualClock(),
  resolver?: (
    target: CompiledRoute["target"],
    defaults: CompiledRoute["defaults"],
    bindingRef: import("../plane/types.js").ChannelReplyBindingRef,
  ) => CreateAgentConfig,
) {
  const account = makeAccount(makeRoute());
  return new BindingEngine({
    organizationId: ORGANIZATION_ID,
    controlPlane: makeControlPlane(account),
    logger: SILENT,
    clock,
    store,
    daemon,
    resolveAgentSpec:
      resolver ??
      (() => ({
        provider: "codex",
        cwd: "/tmp/repo",
      })),
  });
}

// --- Harness ---------------------------------------------------------------

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-bindings-db-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ($1, 'Channel Org', 'channel-org')`,
    [ORGANIZATION_ID],
  );
  store = new ChannelStore(bundle.runtime);
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

// --- deriveBindingKey ------------------------------------------------------

describe("applyRouteAutoAccept", () => {
  it("sets auto_accept only when every tool class is auto-allowed", () => {
    const base = { provider: "grok", cwd: "/tmp/repo" };
    assert.deepEqual(
      applyRouteAutoAccept(
        base,
        makeRoute("C0", { approval: [{ match: "*", mode: "auto-allow" }] }),
      ).featureValues,
      { auto_accept: true },
    );
    assert.equal(applyRouteAutoAccept(base, makeRoute()).featureValues, undefined);
  });
});

describe("deriveBindingKey", () => {
  it("keys on the native thread for binding.key = thread", () => {
    const key = deriveBindingKey(
      message({
        conversation: {
          kind: "thread",
          id: "172.0",
          rootConversationId: CONVERSATION,
          threadId: "172.0",
        },
      }),
      makeRoute(),
    );
    assert.deepEqual(key, { externalConversationId: CONVERSATION, externalThreadId: "172.0" });
  });

  it("collapses threads for binding.key = channel", () => {
    const key = deriveBindingKey(
      message({
        conversation: {
          kind: "thread",
          id: "172.0",
          rootConversationId: CONVERSATION,
          threadId: "172.0",
        },
      }),
      makeRoute(CONVERSATION, { defaults: { bindingKey: "channel" } }),
    );
    assert.deepEqual(key, { externalConversationId: CONVERSATION, externalThreadId: null });
  });

  it("binds a root-level Slack marker at its own minted thread under reply.anchor = thread", () => {
    const key = deriveBindingKey(message({ externalMessageId: "1700000000.000009" }), makeRoute());
    assert.deepEqual(key, {
      externalConversationId: CONVERSATION,
      externalThreadId: "1700000000.000009",
    });
  });

  it("keeps the conversation-level key for a root marker under reply.anchor = default", () => {
    const key = deriveBindingKey(
      message({ externalMessageId: "1700000000.000009" }),
      makeRoute(CONVERSATION, { defaults: { replyAnchor: "default" } }),
    );
    assert.deepEqual(key, { externalConversationId: CONVERSATION, externalThreadId: null });
  });

  it("stays conversation-level under binding.key = channel even with the thread anchor", () => {
    const key = deriveBindingKey(
      message({ externalMessageId: "1700000000.000009" }),
      makeRoute(CONVERSATION, { defaults: { bindingKey: "channel" } }),
    );
    assert.deepEqual(key, { externalConversationId: CONVERSATION, externalThreadId: null });
  });

  it("stays conversation-level when the marker carries no native Slack ts", () => {
    const key = deriveBindingKey(message(), makeRoute());
    assert.deepEqual(key, { externalConversationId: CONVERSATION, externalThreadId: null });
  });

  it("never marker-keys a DM root marker (no thread level in DMs)", () => {
    const key = deriveBindingKey(
      message({
        conversation: { kind: "dm", id: "D0PEER", rootConversationId: "D0PEER", threadId: null },
        externalMessageId: "1700000000.000009",
      }),
      makeRoute(),
    );
    assert.deepEqual(key, { externalConversationId: "D0PEER", externalThreadId: null });
  });

  it("never marker-keys on a non-Slack channel", () => {
    const key = deriveBindingKey(
      message({ channel: "telegram", externalMessageId: "424242" }),
      makeRoute(),
    );
    assert.deepEqual(key, { externalConversationId: CONVERSATION, externalThreadId: null });
  });
});

// --- bind (marker-keyed thread anchor) --------------------------------------

describe("bind (root marker, reply.anchor = thread)", () => {
  const MARKER_TS = "1700000000.000001";

  it("binds the marker at its minted-thread key; the thread's first reply steers the same session", async () => {
    const { daemon, created } = makeFakeDaemon();
    const engine = makeEngine(store, daemon);

    const outcome = await engine.bindOrSteer(
      message({ externalMessageId: MARKER_TS }),
      ...routed(),
    );
    assert.equal(outcome.kind, "bound");

    const binding = await store.findThreadBinding(
      ORGANIZATION_ID,
      ACCOUNT_ID,
      CONVERSATION,
      MARKER_TS,
    );
    assert.equal(binding?.status, "bound");
    assert.equal(binding?.agentId, outcome.kind === "bound" ? outcome.agentId : "");
    assert.equal(
      await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, CONVERSATION, null),
      undefined,
      "the conversation level stays unbound: the marker is its own thread root",
    );

    const followUp = message({
      conversation: {
        kind: "thread",
        id: MARKER_TS,
        rootConversationId: CONVERSATION,
        threadId: MARKER_TS,
      },
      externalMessageId: "1700000000.000002",
      text: "continue",
    });
    const steered = await engine.bindOrSteer(followUp, ...routed());
    assert.equal(steered.kind, "steered");
    assert.equal(steered.kind === "steered" ? steered.agentId : "", binding?.agentId);
    assert.equal(created.length, 1, "the thread follow-up reuses the marker's session");
  });
});

// --- bind (first mention) --------------------------------------------------

describe("bind (first mention)", () => {
  it("creates an agent, delivers the first prompt, and resolves the marker", async () => {
    const { daemon, created, messages, sources } = makeFakeDaemon();
    const engine = makeEngine(store, daemon);

    const outcome = await engine.bindOrSteer(message(), ...routed());

    assert.equal(outcome.kind, "bound");
    assert.equal(outcome.kind === "bound" ? outcome.newSession : false, true);
    assert.equal(created.length, 1, "exactly one agent created");
    assert.equal(messages.length, 1, "the first message is the session's first prompt");
    assert.equal(messages[0]?.text, "slack:U0ALICE: start the build", "the sender line");
    assert.deepEqual(
      sources.map((source) => source?.senderIdentity),
      [INITIATOR, INITIATOR],
    );
    assert.equal(messages[0]?.steer, true, "a first prompt is the request its retry repeats");

    const binding = await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, CONVERSATION, null);
    assert.equal(binding?.status, "bound");
    assert.equal(binding?.agentId, outcome.kind === "bound" ? outcome.agentId : "");
  });

  it("opens the thread's workspace named from the first mention (A3)", async () => {
    const { daemon, created, workspaces } = makeFakeDaemon();
    const engine = makeEngine(store, daemon);

    const route = makeRoute("C0NAMED");
    await engine.bindOrSteer(
      message({
        text: "start the build",
        conversation: {
          kind: "channel",
          id: "C0NAMED",
          rootConversationId: "C0NAMED",
          threadId: null,
        },
      }),
      makeAccount(route),
      route,
    );

    assert.deepEqual(workspaces, [{ cwd: "/tmp/repo", prompt: "start the build" }]);
    assert.equal(created[0]?.workspaceId, "workspace-0", "the session lands in that workspace");
    // The session is named from the trigger's own text, not from the rendered
    // prompt (a sender line or the context header); the execution id rides on
    // a label for orphan recovery.
    assert.equal(created[0]?.title, "start the build");
    assert.match(created[0]?.labels[CHANNEL_EXECUTION_ID_LABEL] ?? "", /^[0-9a-f-]{36}$/u);
  });

  it("leaves placement to the daemon when workspace organization is off (A6)", async () => {
    const { daemon, created, workspaces } = makeFakeDaemon();
    const engine = makeEngine(store, daemon);
    const route = makeRoute("C0UNORGANIZED", { defaults: { workspace: { organize: false } } });

    await engine.bindOrSteer(
      message({
        text: "start the build",
        conversation: {
          kind: "channel",
          id: "C0UNORGANIZED",
          rootConversationId: "C0UNORGANIZED",
          threadId: null,
        },
      }),
      makeAccount(route),
      route,
    );

    assert.deepEqual(workspaces, [], "no workspace is created");
    assert.equal(created[0]?.workspaceId, null, "create_agent carries no workspace");
  });

  it("turns Auto Accept on when the Route accepts every permission request", async () => {
    const { daemon, created } = makeFakeDaemon();
    const engine = makeEngine(store, daemon);
    const route = makeRoute("C0AUTOALLOW", {
      approval: [{ match: "*", mode: "auto-allow" }],
    });

    await engine.bindOrSteer(
      message({
        text: "hi",
        conversation: {
          kind: "channel",
          id: "C0AUTOALLOW",
          rootConversationId: "C0AUTOALLOW",
          threadId: null,
        },
      }),
      makeAccount(route),
      route,
    );

    assert.equal(created[0]?.config.featureValues?.["auto_accept"], true);
  });

  it("leaves Auto Accept unset when the Route still prompts for some tools", async () => {
    const { daemon, created } = makeFakeDaemon();
    const engine = makeEngine(store, daemon);
    const route = makeRoute("C0PROMPT");

    await engine.bindOrSteer(
      message({
        text: "hi",
        conversation: {
          kind: "channel",
          id: "C0PROMPT",
          rootConversationId: "C0PROMPT",
          threadId: null,
        },
      }),
      makeAccount(route),
      route,
    );

    assert.equal(created[0]?.config.featureValues?.["auto_accept"], undefined);
  });

  // Retargeting retires a running session, so it is gated like starting one:
  // an inbound the route would not admit must leave the session alone.
  it("does not retire a retargeted session for an inbound it would not admit", async () => {
    const { daemon, created } = makeFakeDaemon();
    const engine = makeEngine(store, daemon);
    const conversation = {
      kind: "channel" as const,
      id: "C0RETARGETGATE",
      rootConversationId: "C0RETARGETGATE",
      threadId: null,
    };
    const route = makeRoute("C0RETARGETGATE");
    const bound = await engine.bindOrSteer(
      message({ conversation, text: "start the build" }),
      makeAccount(route),
      route,
    );
    assert.equal(bound.kind, "bound");

    // The route now points at another agent, but this inbound does not mention
    // the bot: it may not start a session, so it may not end one either.
    const repointed: CompiledRoute = {
      ...route,
      target: { kind: "agent", agent: "reviewer", environment: "repo", template: null },
    };
    const outcome = await engine.bindOrSteer(
      message({ conversation, text: "just chatting", mentionedBot: false }),
      makeAccount(repointed),
      repointed,
    );

    assert.equal(outcome.kind, "ignored");
    assert.equal(created.length, 1, "no session is minted");
    const binding = await store.findThreadBinding(
      ORGANIZATION_ID,
      ACCOUNT_ID,
      "C0RETARGETGATE",
      null,
    );
    assert.equal(
      binding?.agentId,
      bound.kind === "bound" ? bound.agentId : "",
      "the bound session is untouched",
    );
  });

  it("records the created agent's home (create-time cwd) through noteAgentCwd", async () => {
    const { daemon, created } = makeFakeDaemon();
    const cwds: { agentId: string; cwd: string }[] = [];
    const route = makeRoute("C0CWD");
    const account = makeAccount(route);
    const engine = new BindingEngine({
      organizationId: ORGANIZATION_ID,
      controlPlane: makeControlPlane(account),
      logger: SILENT,
      clock: new ManualClock(),
      store,
      daemon,
      resolveAgentSpec: () => ({ provider: "codex", cwd: "/workspace/media" }),
      // COMPAT(clisbot-control-plane): the plane-owned agentId→cwd record
      // (the relay's native-media home, G7–G11).
      noteAgentCwd: (agentId, cwd) => {
        cwds.push({ agentId, cwd });
      },
    });

    const outcome = await engine.bindOrSteer(
      message({
        conversation: {
          kind: "channel",
          id: "C0CWD",
          rootConversationId: "C0CWD",
          threadId: null,
        },
      }),
      account,
      route,
    );

    assert.equal(outcome.kind, "bound");
    assert.equal(created.length, 1);
    assert.deepEqual(
      cwds,
      [{ agentId: outcome.kind === "bound" ? outcome.agentId : "", cwd: "/workspace/media" }],
      "the recorded home is the create config's cwd, for the created agent",
    );
  });

  it("passes the account channel into the binding ref the tool-path URL embeds", async () => {
    const { daemon, created } = makeFakeDaemon();
    const refs: import("../plane/types.js").ChannelReplyBindingRef[] = [];
    const engine = makeEngine(store, daemon, new ManualClock(), (target, defaults, bindingRef) => {
      refs.push(bindingRef);
      return { provider: "codex", cwd: "/tmp/repo" };
    });
    const route = makeRoute("C0REFCAPTURE");

    const outcome = await engine.bindOrSteer(
      message({
        conversation: {
          kind: "channel",
          id: "C0REFCAPTURE",
          rootConversationId: "C0REFCAPTURE",
          threadId: null,
        },
      }),
      makeAccount(route),
      route,
    );
    assert.equal(outcome.kind, "bound");
    assert.equal(created.length, 1);
    assert.equal(refs.length, 1, "the resolver is called exactly once, with the binding ref");
    assert.deepEqual(refs[0], {
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalConversationId: "C0REFCAPTURE",
      externalThreadId: null,
    });
  });

  it("ignores an unmentioned first message when requireMention is on", async () => {
    const { daemon, created } = makeFakeDaemon();
    const engine = makeEngine(store, daemon);
    const route = makeRoute("C0QUIET");
    const conversation: InboundConversationDetail = {
      kind: "channel",
      id: "C0QUIET",
      rootConversationId: "C0QUIET",
      threadId: null,
    };

    const outcome = await engine.bindOrSteer(
      message({ mentionedBot: false, text: "hello", conversation }),
      makeAccount(route),
      route,
    );
    assert.equal(outcome.kind, "ignored");
    assert.equal(
      outcome.kind === "ignored" ? outcome.reason : "",
      "not mentioned; requireMention is on",
    );
    assert.equal(created.length, 0, "no agent created for an unmentioned first message");
  });

  it("ignores a sender that mayTrigger denies", async () => {
    const { daemon, created, sources } = makeFakeDaemon();
    const account = makeAccount(makeRoute());
    // A route with no default roles and no assignments: nobody holds
    // `bot.interact`, so the gate denies every sender.
    const locked: CompiledRoute = {
      ...makeRoute(),
      defaultRoles: [],
      assignments: [],
    };
    const engine = makeEngine(store, daemon);
    const outcome = await engine.bindOrSteer(
      message({ senderIdentity: "slack:U0STRANGER" }),
      account,
      locked,
    );
    assert.equal(outcome.kind, "ignored");
    assert.equal(
      outcome.kind === "ignored" ? outcome.reason : "",
      "sender may not trigger this route",
    );
    assert.equal(created.length, 0, "mayTrigger denial creates nothing and records no marker");
    assert.equal(sources.length, 0, "denied senders never reach the ticket-minting daemon facade");
  });
});

// --- follow-up (resume / steer) --------------------------------------------

describe("follow-up (resume / steer)", () => {
  function conversationOf(externalConversationId: string): InboundConversationDetail {
    return {
      kind: "channel",
      id: externalConversationId,
      rootConversationId: externalConversationId,
      threadId: null,
    };
  }

  async function bindFirst(externalConversationId: string) {
    const fake = makeFakeDaemon();
    const engine = makeEngine(store, fake.daemon);
    const route = makeRoute(externalConversationId);
    const outcome = await engine.bindOrSteer(
      message({ conversation: conversationOf(externalConversationId) }),
      makeAccount(route),
      route,
    );
    assert.equal(outcome.kind, "bound");
    return { engine, route, conversation: conversationOf(externalConversationId), fake };
  }

  it("steers an unmentioned follow-up into the bound session in auto mode", async () => {
    const { engine, route, conversation, fake } = await bindFirst("C0STEER");

    const outcome = await engine.bindOrSteer(
      message({ mentionedBot: false, text: "and run the tests", conversation }),
      makeAccount(route),
      route,
    );
    assert.equal(outcome.kind, "steered");
    const last = fake.messages.at(-1);
    assert.equal(last?.text, "slack:U0ALICE: and run the tests");
    assert.equal(last?.steer, true, "a follow-up steers the existing turn");
  });

  it("requires a fresh mention in mention-only mode", async () => {
    const { engine, conversation } = await bindFirst("C0ONLY");
    const mentionOnly = makeRoute("C0ONLY", {
      defaults: { ...DEFAULTS, followUp: { mode: "mention-only", ttlMinutes: 60 } },
    });
    const outcome = await engine.bindOrSteer(
      message({ mentionedBot: false, conversation }),
      makeAccount(mentionOnly),
      mentionOnly,
    );
    assert.equal(outcome.kind, "ignored");
  });

  it("idle-TTL: an unmentioned follow-up is ignored once the session idles out", async () => {
    const clock = new ManualClock(0);
    const { daemon } = makeFakeDaemon();
    const { route, conversation } = await bindFirst("C0IDLE");
    const engine = new BindingEngine({
      organizationId: ORGANIZATION_ID,
      controlPlane: makeControlPlane(makeAccount(route)),
      logger: SILENT,
      clock,
      store,
      daemon,
      resolveAgentSpec: () => ({ provider: "codex", cwd: "/tmp/repo" }),
    });
    // Record activity at t=0 so the idle window is measured from now.
    const warm = await engine.bindOrSteer(
      message({ mentionedBot: true, conversation }),
      makeAccount(route),
      route,
    );
    assert.equal(warm.kind, "steered");

    // Past the 60m idle window: the session idled out and needs a mention.
    clock.advance(61 * 60_000);
    const cold = await engine.bindOrSteer(
      message({ mentionedBot: false, conversation }),
      makeAccount(route),
      route,
    );
    assert.equal(cold.kind, "ignored");
    assert.match(cold.kind === "ignored" ? cold.reason : "", /window ended/u);
  });

  it("requires a mention for a bound session with no activity in this process", async () => {
    const { daemon } = makeFakeDaemon();
    const { route, conversation } = await bindFirst("C0RESTART");
    // A new engine is a Hub restart: the in-memory follow-up window is gone.
    const engine = new BindingEngine({
      organizationId: ORGANIZATION_ID,
      controlPlane: makeControlPlane(makeAccount(route)),
      logger: SILENT,
      clock: new ManualClock(0),
      store,
      daemon,
      resolveAgentSpec: () => ({ provider: "codex", cwd: "/tmp/repo" }),
    });
    const unmentioned = await engine.bindOrSteer(
      message({ mentionedBot: false, conversation }),
      makeAccount(route),
      route,
    );
    assert.equal(unmentioned.kind, "ignored");
    const mentioned = await engine.bindOrSteer(
      message({ mentionedBot: true, conversation }),
      makeAccount(route),
      route,
    );
    assert.equal(mentioned.kind, "steered");
  });

  it("applies the conversation override and ends a pause at the next mention", async () => {
    const { engine, conversation } = await bindFirst("C0OVERRIDE");
    const route = makeRoute("C0OVERRIDE", {
      defaults: { ...DEFAULTS, followUp: { mode: "mention-only", ttlMinutes: 5 } },
    });
    const key = {
      organizationId: ORGANIZATION_ID,
      channel: "slack" as const,
      accountId: ACCOUNT_ID,
      externalConversationId: "C0OVERRIDE",
      externalThreadId: null,
    };
    const unmentioned = () =>
      engine.bindOrSteer(message({ mentionedBot: false, conversation }), makeAccount(route), route);

    await store.access.setConversationFollowUp(key, { mode: "auto", setBy: INITIATOR });
    assert.equal((await unmentioned()).kind, "steered", "the override replaces mention-only");

    await store.access.setConversationFollowUp(key, { mode: "paused", setBy: INITIATOR });
    assert.equal((await unmentioned()).kind, "ignored", "a pause needs a mention");
    const refused = await engine.bindOrSteer(
      message({ mentionedBot: true, senderIdentity: "slack:U0STRANGER", conversation }),
      makeAccount(route),
      route,
    );
    assert.equal(refused.kind, "ignored");
    assert.equal(
      (await store.access.findConversationFollowUp(key))?.mode,
      "paused",
      "a refused mention leaves the pause in place",
    );
    const mentioned = await engine.bindOrSteer(
      message({ mentionedBot: true, conversation }),
      makeAccount(route),
      route,
    );
    assert.equal(mentioned.kind, "steered");
    assert.equal(await store.access.findConversationFollowUp(key), undefined);
    assert.equal((await unmentioned()).kind, "ignored", "back to the Route's mention-only");
  });
});

// --- admitFollowUp (pure) --------------------------------------------------

describe("admitFollowUp", () => {
  it("always admits a mention", () => {
    assert.deepEqual(admitFollowUp({ mentionedBot: true }, DEFAULTS, true), { allowed: true });
  });
  it("denies an unmentioned follow-up in mention-only mode", () => {
    assert.equal(
      admitFollowUp(
        { mentionedBot: false },
        { ...DEFAULTS, followUp: { mode: "mention-only", ttlMinutes: 60 } },
        false,
      ).allowed,
      false,
    );
  });
  it("denies an idle auto follow-up", () => {
    assert.equal(admitFollowUp({ mentionedBot: false }, DEFAULTS, true).allowed, false);
  });
  it("admits every message on a route that does not require a mention", () => {
    const open = { ...DEFAULTS, requireMention: false };
    assert.equal(admitFollowUp({ mentionedBot: false }, open, true, "mention-only").allowed, true);
  });
  it("lets the conversation mode replace the Route mode", () => {
    assert.equal(
      admitFollowUp({ mentionedBot: false }, DEFAULTS, false, "mention-only").allowed,
      false,
    );
  });
});

// --- orphan recovery (restart/resume) --------------------------------------

describe("orphan recovery (restart / resume)", () => {
  it("re-binds a surviving agent by its execution-id label and never re-creates", async () => {
    const executionId = "execution-orphan";
    await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalConversationId: "C0ORPHAN",
      externalThreadId: null,
      pendingExecutionId: executionId,
      initiator: INITIATOR,
      route: {},
    });
    const surviving = snapshotOf("agent-100", null, channelExecutionLabels(executionId));
    const { daemon, created } = makeFakeDaemon([surviving]);
    const engine = makeEngine(store, daemon);

    const recovered = await engine.recoverOrphans();
    assert.equal(recovered.rebound, 1);
    assert.equal(recovered.leftPending, 0);
    assert.equal(created.length, 0, "orphan recovery never re-creates the agent");

    const binding = await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0ORPHAN", null);
    assert.equal(binding?.status, "bound");
    assert.equal(binding?.agentId, "agent-100", "re-bound to the surviving agent, no duplicate");
  });

  // COMPAT(channel-execution-title-marker): remove with the title fallback.
  it("re-binds an agent created before the label by its old title marker", async () => {
    const executionId = "execution-before-label";
    await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalConversationId: "C0LEGACY",
      externalThreadId: null,
      pendingExecutionId: executionId,
      initiator: INITIATOR,
      route: {},
    });
    const { daemon } = makeFakeDaemon([
      snapshotOf("agent-legacy", `clisbot-channel:${executionId}`),
    ]);

    assert.equal((await makeEngine(store, daemon).recoverOrphans()).rebound, 1);
    const binding = await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0LEGACY", null);
    assert.equal(binding?.agentId, "agent-legacy");
  });

  // The tool-path capability is what a Channel agent replies through, and two
  // of its consumers must not take the requester from the model: the ported
  // channel tools authorize against it, and a command button this Agent posts
  // is minted for exactly that actor. It is issued with the turn's own sender.
  it("issues the reply capability with the turn's requester", async () => {
    const { daemon } = makeFakeDaemon();
    const account = makeAccount(
      makeRoute("C0TOOL", { defaults: { outbound: { path: "tool", template: null } } }),
    );
    const capabilities = new ChannelReplyCapabilityRegistry();
    let issuedToken: string | undefined;
    const engine = new BindingEngine({
      organizationId: ORGANIZATION_ID,
      controlPlane: makeControlPlane(account),
      logger: SILENT,
      clock: new ManualClock(),
      store,
      daemon,
      resolveAgentSpec: (_target, _defaults, _ref, reply) => {
        issuedToken = reply?.token;
        return { provider: "codex", cwd: "/tmp/repo" };
      },
      resolveAgentAccessTarget: () => ({ daemonReference: "daemon-1", projectId: "project-1" }),
      replyCapabilities: capabilities,
    });
    const outcome = await engine.bindOrSteer(
      message({
        conversation: {
          kind: "channel",
          id: "C0TOOL",
          rootConversationId: "C0TOOL",
          threadId: null,
        },
      }),
      account,
      account.routes[0] as CompiledRoute,
    );
    assert.equal(outcome.kind, "bound");
    assert.ok(issuedToken);
    // The NATIVE id, as the platform reports a click back — the plane's
    // `<channel>:` prefix belongs to the identity model, not to Slack.
    assert.equal(capabilities.resolve(issuedToken, ORGANIZATION_ID)?.requesterSenderId, "U0ALICE");
  });

  // The Agent keeps one capability for the whole session, so the turn it is
  // answering has to be restamped on every steer: the tool's delivery keys and
  // its output ceiling are scoped by it, and the model reuses "reply-1" in
  // every turn.
  it("restamps the reply capability with each follow-up turn", async () => {
    const { daemon } = makeFakeDaemon();
    const account = makeAccount(
      makeRoute("C0TOOL", { defaults: { outbound: { path: "tool", template: null } } }),
    );
    const capabilities = new ChannelReplyCapabilityRegistry();
    let issuedToken: string | undefined;
    const engine = new BindingEngine({
      organizationId: ORGANIZATION_ID,
      controlPlane: makeControlPlane(account),
      logger: SILENT,
      clock: new ManualClock(),
      store,
      daemon,
      resolveAgentSpec: (_target, _defaults, _ref, reply) => {
        issuedToken = reply?.token;
        return { provider: "codex", cwd: "/tmp/repo" };
      },
      resolveAgentAccessTarget: () => ({ daemonReference: "daemon-1", projectId: "project-1" }),
      replyCapabilities: capabilities,
    });
    const inbound = () =>
      message({
        conversation: {
          kind: "channel",
          id: "C0TURNS",
          rootConversationId: "C0TURNS",
          threadId: null,
        },
      });
    const route = account.routes[0] as CompiledRoute;
    const created = await engine.bindOrSteer(inbound(), account, route);
    assert.equal(created.kind, "bound");
    assert.ok(issuedToken);
    const firstTurn = capabilities.resolve(issuedToken, ORGANIZATION_ID)?.turnId;
    assert.ok(firstTurn, "the creating turn stamps the capability");
    const steered = await engine.bindOrSteer(inbound(), account, route);
    assert.equal(steered.kind, "steered");
    const secondTurn = capabilities.resolve(issuedToken, ORGANIZATION_ID)?.turnId;
    assert.ok(secondTurn);
    assert.notEqual(secondTurn, firstTurn, "the follow-up turn replaced the create-time one");
  });

  // The daemon keeps the MCP URL a session was created with, so a session whose
  // capability was revoked or expired answered "unknown, expired, or revoked
  // channel reply capability" on every later turn. The next follow-up starts a
  // fresh session holding a live capability instead of steering into silence.
  it("replaces a bound session whose reply capability is gone", async () => {
    const { daemon, created } = makeFakeDaemon();
    const account = makeAccount(
      makeRoute("C0SILENT", { defaults: { outbound: { path: "tool", template: null } } }),
    );
    const capabilities = new ChannelReplyCapabilityRegistry();
    const issued: string[] = [];
    const engine = new BindingEngine({
      organizationId: ORGANIZATION_ID,
      controlPlane: makeControlPlane(account),
      logger: SILENT,
      clock: new ManualClock(),
      store,
      daemon,
      resolveAgentSpec: (_target, _defaults, _ref, reply) => {
        if (reply !== undefined) issued.push(reply.token);
        return { provider: "codex", cwd: "/tmp/repo" };
      },
      resolveAgentAccessTarget: () => ({ daemonReference: "daemon-1", projectId: "project-1" }),
      replyCapabilities: capabilities,
    });
    const inbound = () =>
      message({
        conversation: {
          kind: "channel",
          id: "C0SILENT",
          rootConversationId: "C0SILENT",
          threadId: null,
        },
      });
    const route = account.routes[0] as CompiledRoute;
    const first = await engine.bindOrSteer(inbound(), account, route);
    assert.equal(first.kind, "bound");
    capabilities.revokeAccount(ORGANIZATION_ID, "slack", account.accountId);

    const next = await engine.bindOrSteer(inbound(), account, route);

    assert.equal(next.kind, "bound");
    assert.notEqual(next.kind === "bound" && next.agentId, first.kind === "bound" && first.agentId);
    assert.equal(created.length, 2);
    assert.equal(issued.length, 2);
    assert.equal(
      capabilities.resolve(issued[1] as string, ORGANIZATION_ID)?.agentId,
      next.kind === "bound" ? next.agentId : undefined,
    );
  });

  it("leaves a marker pending when no agent survived the create", async () => {
    await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalConversationId: "C0GHOST",
      externalThreadId: null,
      pendingExecutionId: "execution-ghost",
      initiator: INITIATOR,
      route: {},
    });
    const { daemon } = makeFakeDaemon([]);
    const engine = makeEngine(store, daemon);

    const recovered = await engine.recoverOrphans();
    assert.equal(recovered.rebound, 0);
    assert.equal(recovered.leftPending, 1, "no surviving agent: the marker stays pending");
    const binding = await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0GHOST", null);
    assert.equal(binding?.status, "pending", "not abandoned: a later inbound can rebind it");
  });

  it("an inline pending marker re-binds when its agent survived", async () => {
    const executionId = "execution-inline";
    await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalConversationId: "C0INLINE",
      externalThreadId: null,
      pendingExecutionId: executionId,
      initiator: INITIATOR,
      route: {},
    });
    const surviving = snapshotOf("agent-200", null, channelExecutionLabels(executionId));
    const { daemon, created, messages } = makeFakeDaemon([surviving]);
    const engine = makeEngine(store, daemon);

    const outcome = await engine.bindOrSteer(
      message({
        conversation: { ...CHANNEL_CONVERSATION, id: "C0INLINE", rootConversationId: "C0INLINE" },
      }),
      ...routed(),
    );
    assert.equal(outcome.kind, "bound");
    assert.equal(
      outcome.kind === "bound" ? outcome.newSession : false,
      false,
      "re-bound, not a new session",
    );
    assert.equal(created.length, 0, "the inline path re-binds without re-creating");
    assert.deepEqual(
      messages.map((sent) => sent.agentId),
      ["agent-200"],
      "the message that drove the re-bind reaches the agent",
    );
  });

  it("an unconfirmed create keeps its marker and retries the message", async () => {
    const conversation = { ...CHANNEL_CONVERSATION, id: "C0SLOW", rootConversationId: "C0SLOW" };
    const { daemon, messages } = makeFakeDaemon();
    let creates = 0;
    const create = daemon.createAgent;
    daemon.createAgent = async (config, options) => {
      creates += 1;
      if (creates === 1) throw new Error("create_agent_request timed out");
      return create(config, options);
    };
    const clock = new ManualClock(Date.now());
    const engine = makeEngine(store, daemon, clock);

    await assert.rejects(engine.bindOrSteer(message({ conversation }), ...routed()));
    const marker = await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0SLOW", null);
    assert.equal(marker?.status, "pending", "the daemon may hold the Agent: the marker stays");

    await assert.rejects(
      engine.bindOrSteer(message({ conversation }), ...routed()),
      { name: "ChannelAgentCreatePendingError" },
      "inside the wait the message is retried, not completed unanswered",
    );

    clock.advance(PENDING_MARKER_TTL_MS + 1_000);
    const outcome = await engine.bindOrSteer(message({ conversation }), ...routed());
    assert.equal(outcome.kind === "bound" && outcome.newSession, true, "the thread starts over");
    assert.equal(messages.length, 1);
  });

  it("hands the message back when the Host is busy starting other sessions", async () => {
    const conversation = { ...CHANNEL_CONVERSATION, id: "C0BUSY", rootConversationId: "C0BUSY" };
    const { daemon, created } = makeFakeDaemon();
    daemon.hasFreeCreateSlot = () => false;
    const engine = makeEngine(store, daemon);

    const outcome = await engine.bindOrSteer(message({ conversation }), ...routed());
    assert.equal(outcome.kind, "deferred");
    assert.equal(created.length, 0);
    assert.equal(
      await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0BUSY", null),
      undefined,
      "no marker: the retried message starts clean",
    );
  });

  it("binds the reply capability an unconfirmed create was launched with", async () => {
    const conversation = { ...CHANNEL_CONVERSATION, id: "C0LATE", rootConversationId: "C0LATE" };
    const capabilities = new ChannelReplyCapabilityRegistry();
    const agents: AgentSnapshot[] = [];
    const { daemon, created, messages } = makeFakeDaemon(agents);
    daemon.createAgent = async (config, options) => {
      // The daemon finishes the create; only the Hub's call gives up on it.
      agents.push(snapshotOf("agent-late", null, options?.labels ?? {}));
      created.push({ config, title: null, labels: options?.labels ?? {}, workspaceId: null });
      throw new Error("RPC create_agent_request timed out");
    };
    const route = makeRoute("C0LATE", {
      defaults: { outbound: { path: "tool", template: null } },
    });
    const account = makeAccount(route);
    const engine = new BindingEngine({
      organizationId: ORGANIZATION_ID,
      controlPlane: makeControlPlane(account),
      logger: SILENT,
      clock: new ManualClock(Date.now()),
      store,
      daemon,
      replyCapabilities: capabilities,
      resolveAgentAccessTarget: () => ({ projectRoot: "/tmp/repo" }) as never,
      resolveAgentSpec: () => ({ provider: "codex", cwd: "/tmp/repo" }),
    });

    await assert.rejects(engine.bindOrSteer(message({ conversation }), account, route));
    const retried = await engine.bindOrSteer(message({ conversation }), account, route);
    assert.equal(retried.kind === "bound" && retried.agentId, "agent-late");
    assert.equal(created.length, 1, "the Agent that was created is used, not replaced");
    assert.equal(capabilities.holdsAgentCapability("agent-late"), true);
    assert.equal(messages.length, 1);
  });

  it("a create that never reached the Host releases its marker", async () => {
    const conversation = { ...CHANNEL_CONVERSATION, id: "C0SPEC", rootConversationId: "C0SPEC" };
    const { daemon, created } = makeFakeDaemon();
    const engine = makeEngine(store, daemon, new ManualClock(), () => {
      throw new Error("no such agent");
    });

    await assert.rejects(engine.bindOrSteer(message({ conversation }), ...routed()));
    assert.equal(created.length, 0);
    assert.equal(
      await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0SPEC", null),
      undefined,
      "nothing to recover, so the thread is not wedged",
    );
  });

  it("a first prompt the Agent did not take is retried into the bound session", async () => {
    const conversation = { ...CHANNEL_CONVERSATION, id: "C0DROP", rootConversationId: "C0DROP" };
    const { daemon, messages, created, takeReceipt } = makeFakeDaemon();
    const send = daemon.sendAgentMessage;
    let sends = 0;
    daemon.sendAgentMessage = async (agentId, text, options) => {
      sends += 1;
      if (sends > 1) return send(agentId, text, options);
      // The daemon wrote its receipt and the answer never came back: the
      // retry is a replay of this same message id.
      await takeReceipt(agentId, text, options);
      throw new Error("rpc timed out");
    };
    const engine = makeEngine(store, daemon);
    const opener = message({ conversation, externalMessageId: "1700000000.000900" });

    await assert.rejects(engine.bindOrSteer(opener, ...routed()));
    // The session is bound now, so the retry arrives as a follow-up; it must be
    // the same request, or the daemon refuses the message id for good.
    const retried = await engine.bindOrSteer(opener, ...routed());
    assert.equal(retried.kind, "steered");
    assert.equal(created.length, 1, "one session, not one per attempt");
    assert.equal(messages.length, 1);
  });

  it("an inline pending marker refuses a sender that mayTrigger denies (no re-bind)", async () => {
    const executionId = "execution-gate";
    await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalConversationId: "C0GATE",
      externalThreadId: null,
      pendingExecutionId: executionId,
      initiator: INITIATOR,
      route: {},
    });
    // A surviving agent exists, so the re-bind is technically possible — the
    // gate must still hold: the re-bind is the inbound driving it, and this
    // sender holds no role on the route.
    const surviving = snapshotOf("agent-300", null, channelExecutionLabels(executionId));
    const { daemon, created } = makeFakeDaemon([surviving]);
    const engine = makeEngine(store, daemon);
    const locked: CompiledRoute = {
      ...makeRoute(),
      defaultRoles: [],
      assignments: [],
    };

    const outcome = await engine.bindOrSteer(
      message({
        senderIdentity: "slack:U0STRANGER",
        conversation: {
          ...CHANNEL_CONVERSATION,
          id: "C0GATE",
          rootConversationId: "C0GATE",
        },
      }),
      makeAccount(locked),
      locked,
    );
    assert.equal(outcome.kind, "ignored");
    assert.equal(
      outcome.kind === "ignored" ? outcome.reason : "",
      "sender may not trigger this route",
    );
    const binding = await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0GATE", null);
    assert.equal(
      binding?.status,
      "pending",
      "the gate rejects before the re-bind; the marker stays pending",
    );
    assert.equal(created.length, 0, "the denied re-bind never creates or re-binds");
  });

  it("an inline pending marker ignores an unmentioned message when requireMention is on", async () => {
    const executionId = "execution-unmentioned";
    await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalConversationId: "C0UNM",
      externalThreadId: null,
      pendingExecutionId: executionId,
      initiator: INITIATOR,
      route: {},
    });
    const surviving = snapshotOf("agent-310", null, channelExecutionLabels(executionId));
    const { daemon, created } = makeFakeDaemon([surviving]);
    const engine = makeEngine(store, daemon);
    const route = makeRoute();

    const outcome = await engine.bindOrSteer(
      message({
        mentionedBot: false,
        conversation: { ...CHANNEL_CONVERSATION, id: "C0UNM", rootConversationId: "C0UNM" },
      }),
      makeAccount(route),
      route,
    );
    assert.equal(outcome.kind, "ignored");
    assert.equal(
      outcome.kind === "ignored" ? outcome.reason : "",
      "not mentioned; requireMention is on",
    );
    const binding = await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0UNM", null);
    assert.equal(
      binding?.status,
      "pending",
      "an unmentioned message must not pull the thread to bound",
    );
    assert.equal(created.length, 0);
  });

  it("a first mention that lost the insert race re-binds the winner's marker", async () => {
    // Model the race between two concurrent first mentions of the same thread:
    // the winner recorded the marker; this engine's lookup sees no row (the
    // winner had not committed yet) and its record throws the store's
    // conflict. The engine must re-read the key and drive the winner's marker
    // instead of creating a second agent. Thread-scoped key: the store's
    // conflict only fires when the thread id is set (the unique index is
    // NULLS DISTINCT on purpose — a null-key duplicate is an account-layer
    // decision the schema defers, P1).
    const THREAD_TS = "1737000000.000100";
    const executionId = "execution-race-winner";
    await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalConversationId: "C0RACE",
      externalThreadId: THREAD_TS,
      pendingExecutionId: executionId,
      initiator: INITIATOR,
      route: {},
    });
    const surviving = snapshotOf("agent-400", null, channelExecutionLabels(executionId));
    const { daemon, created } = makeFakeDaemon([surviving]);
    let lookups = 0;
    // Own-property override on a prototype chain: the store's methods (and its
    // `database` field, resolved through `store`) stay intact; only the first
    // `findThreadBinding` for the raced key reports the race window.
    const raceStore = Object.create(store) as ChannelStore;
    raceStore.findThreadBinding = async (
      organizationId,
      accountId,
      externalConversationId,
      externalThreadId,
    ) => {
      lookups += 1;
      if (lookups === 1 && externalThreadId === THREAD_TS) return undefined; // the race window
      return store.findThreadBinding(
        organizationId,
        accountId,
        externalConversationId,
        externalThreadId,
      );
    };
    const account = makeAccount(makeRoute());
    const engine = new BindingEngine({
      organizationId: ORGANIZATION_ID,
      controlPlane: makeControlPlane(account),
      logger: SILENT,
      clock: new ManualClock(),
      store: raceStore,
      daemon,
      resolveAgentSpec: () => ({ provider: "codex", cwd: "/tmp/repo" }),
    });

    const outcome = await engine.bindOrSteer(
      message({
        conversation: {
          ...CHANNEL_CONVERSATION,
          id: "C0RACE",
          rootConversationId: "C0RACE",
          threadId: THREAD_TS,
        },
      }),
      account,
      account.routes[0]!,
    );
    assert.equal(outcome.kind, "bound");
    assert.equal(
      outcome.kind === "bound" ? outcome.agentId : "",
      "agent-400",
      "the loser drives the winner's marker to its surviving agent",
    );
    assert.equal(
      outcome.kind === "bound" ? outcome.newSession : true,
      false,
      "re-bound, not a new session",
    );
    assert.equal(created.length, 0, "the race loser never creates a second agent");
  });
});

it("mints the persisted provider bundle after a session reset", async () => {
  const marker = "1700000000.990001";
  await store.access.setConversationSelection(
    {
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalConversationId: CONVERSATION,
      externalThreadId: marker,
    },
    {
      selectedProvider: "claude",
      selectedModel: "sonnet",
      selectedThinkingOption: "high",
      selectedMode: "default",
      selectedFeatureValues: { fast: true },
      selectedBy: INITIATOR,
    },
  );
  const fake = makeFakeDaemon();
  const engine = makeEngine(store, fake.daemon);
  const result = await engine.bindOrSteer(message({ externalMessageId: marker }), ...routed());
  assert.equal(result.kind, "bound");
  assert.deepEqual(fake.created[0]?.config, {
    provider: "claude",
    cwd: "/tmp/repo",
    model: "sonnet",
    thinkingOptionId: "high",
    modeId: "default",
    featureValues: { fast: true },
  });
});
