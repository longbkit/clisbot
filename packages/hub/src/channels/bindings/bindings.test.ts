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
import type { AgentPermissionResponse, AgentSnapshot, CreateAgentConfig } from "../daemon/types.js";
import type { DaemonConnection } from "../daemon/client.js";
import { ManualClock } from "../plane/clock.js";
import type { InboundConversationDetail, InboundMessage, PlaneLogger } from "../plane/types.js";
import { BindingEngine, admitFollowUp, deriveBindingKey, executionMarker } from "./index.js";

const ORGANIZATION_ID = "channel-org";
const ACCOUNT_ID = "work";
const CONVERSATION = "C0APP";
const INITIATOR = "slack:U0ALICE";
const SILENT: PlaneLogger = { warn: () => undefined, info: () => undefined };

// --- Fixtures --------------------------------------------------------------

function snapshotOf(id: string, title: string | null): AgentSnapshot {
  return {
    id,
    provider: "codex",
    cwd: "/tmp/repo",
    title,
    status: "idle",
    createdAt: "2026-08-25T00:00:00Z",
    updatedAt: "2026-08-25T00:00:00Z",
    labels: {},
  };
}

function makeFakeDaemon(listAgents: AgentSnapshot[] = []) {
  const created: { config: CreateAgentConfig; title: string | null }[] = [];
  const messages: { agentId: string; text: string; steer: boolean | null }[] = [];
  const responses: { agentId: string; requestId: string; response: AgentPermissionResponse }[] = [];
  const subscriptions: string[][] = [];
  let seq = 0;
  const daemon: DaemonConnection = {
    discovery: { url: "ws://127.0.0.1:6767/ws", source: "default-port" },
    waitForConnected: async () => undefined,
    createAgent: async (config, options) => {
      created.push({ config, title: options?.title ?? null });
      const id = `agent-${seq++}`;
      return { agentId: id, agent: snapshotOf(id, options?.title ?? null) };
    },
    sendAgentMessage: async (agentId, text, options) => {
      messages.push({ agentId, text, steer: options?.steer ?? null });
    },
    respondToAgentPermission: async (agentId, requestId, response) => {
      responses.push({ agentId, requestId, response });
    },
    listAgents: async () => listAgents,
    setTimelineSubscription: async (agentIds) => {
      subscriptions.push([...agentIds]);
    },
    stop: () => undefined,
  };
  return { daemon, created, messages, responses, subscriptions };
}

const DEFAULTS = {
  requireMention: true,
  followUp: { mode: "auto" as const, ttlMinutes: 60 },
  bindingKey: "thread" as const,
  replyAnchor: "thread" as const,
  sync: {
    finalAnswers: true,
    progress: false,
    toolCalls: false,
    threadLink: "final-only" as const,
  },
};

function makeRoute(
  conversationId = CONVERSATION,
  overrides: {
    approval?: CompiledRoute["approval"];
    defaults?: Partial<CompiledRoute["defaults"]>;
  } = {},
): CompiledRoute {
  return {
    match: { kind: "channel", ids: [conversationId] },
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
    secretRef: "secret-ref",
    transport: {},
    defaultRoles: ["interactor"],
    assignments: [],
    defaults: DEFAULTS,
    approval: [],
    routes: [route],
    fallback: { deny: true },
  };
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

function makeEngine(store: ChannelStore, daemon: DaemonConnection, clock = new ManualClock()) {
  const account = makeAccount(makeRoute());
  return new BindingEngine({
    organizationId: ORGANIZATION_ID,
    controlPlane: makeControlPlane(account),
    logger: SILENT,
    clock,
    store,
    daemon,
    resolveAgentSpec: () => ({ provider: "codex", cwd: "/tmp/repo" }),
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

describe("deriveBindingKey", () => {
  it("keys on the native thread for binding.key = thread", () => {
    const key = deriveBindingKey(
      { kind: "thread", id: "172.0", rootConversationId: CONVERSATION, threadId: "172.0" },
      "thread",
    );
    assert.deepEqual(key, { conversationId: CONVERSATION, externalThreadId: "172.0" });
  });

  it("collapses threads for binding.key = channel", () => {
    const key = deriveBindingKey(
      { kind: "thread", id: "172.0", rootConversationId: CONVERSATION, threadId: "172.0" },
      "channel",
    );
    assert.deepEqual(key, { conversationId: CONVERSATION, externalThreadId: null });
  });
});

// --- bind (first mention) --------------------------------------------------

describe("bind (first mention)", () => {
  it("creates an agent, delivers the first prompt, and resolves the marker", async () => {
    const { daemon, created, messages } = makeFakeDaemon();
    const engine = makeEngine(store, daemon);

    const outcome = await engine.bindOrSteer(message(), makeAccount(makeRoute()), makeRoute());

    assert.equal(outcome.kind, "bound");
    assert.equal(outcome.kind === "bound" ? outcome.newSession : false, true);
    assert.equal(created.length, 1, "exactly one agent created");
    assert.equal(messages.length, 1, "the first message is the session's first prompt");
    assert.equal(messages[0]?.text, "start the build");
    assert.equal(messages[0]?.steer, false, "the first prompt does not steer");

    const binding = await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, CONVERSATION, null);
    assert.equal(binding?.status, "bound");
    assert.equal(binding?.agentId, outcome.kind === "bound" ? outcome.agentId : "");
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
    const { daemon, created } = makeFakeDaemon();
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
  });
});

// --- follow-up (resume / steer) --------------------------------------------

describe("follow-up (resume / steer)", () => {
  function conversationOf(conversationId: string): InboundConversationDetail {
    return {
      kind: "channel",
      id: conversationId,
      rootConversationId: conversationId,
      threadId: null,
    };
  }

  async function bindFirst(conversationId: string) {
    const fake = makeFakeDaemon();
    const engine = makeEngine(store, fake.daemon);
    const route = makeRoute(conversationId);
    const outcome = await engine.bindOrSteer(
      message({ conversation: conversationOf(conversationId) }),
      makeAccount(route),
      route,
    );
    assert.equal(outcome.kind, "bound");
    return { engine, route, conversation: conversationOf(conversationId), fake };
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
    assert.equal(last?.text, "and run the tests");
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
    assert.match(cold.kind === "ignored" ? cold.reason : "", /idled out/u);
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
});

// --- orphan recovery (restart/resume) --------------------------------------

describe("orphan recovery (restart / resume)", () => {
  it("re-binds a surviving agent by its marker title and never re-creates", async () => {
    const executionId = "execution-orphan";
    await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      conversationId: "C0ORPHAN",
      externalThreadId: null,
      pendingExecutionId: executionId,
      initiator: INITIATOR,
      route: {},
    });
    const surviving = snapshotOf("agent-100", executionMarker(executionId));
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

  it("leaves a marker pending when no agent survived the create", async () => {
    await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      conversationId: "C0GHOST",
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
      conversationId: "C0INLINE",
      externalThreadId: null,
      pendingExecutionId: executionId,
      initiator: INITIATOR,
      route: {},
    });
    const surviving = snapshotOf("agent-200", executionMarker(executionId));
    const { daemon, created } = makeFakeDaemon([surviving]);
    const engine = makeEngine(store, daemon);

    const outcome = await engine.bindOrSteer(
      message({
        conversation: { ...CHANNEL_CONVERSATION, id: "C0INLINE", rootConversationId: "C0INLINE" },
      }),
      makeAccount(makeRoute()),
      makeRoute(),
    );
    assert.equal(outcome.kind, "bound");
    assert.equal(
      outcome.kind === "bound" ? outcome.newSession : false,
      false,
      "re-bound, not a new session",
    );
    assert.equal(created.length, 0, "the inline path re-binds without re-creating");
  });

  it("an inline pending marker refuses a sender that mayTrigger denies (no re-bind)", async () => {
    const executionId = "execution-gate";
    await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      conversationId: "C0GATE",
      externalThreadId: null,
      pendingExecutionId: executionId,
      initiator: INITIATOR,
      route: {},
    });
    // A surviving agent exists, so the re-bind is technically possible — the
    // gate must still hold: the re-bind is the inbound driving it, and this
    // sender holds no role on the route.
    const surviving = snapshotOf("agent-300", executionMarker(executionId));
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
      conversationId: "C0UNM",
      externalThreadId: null,
      pendingExecutionId: executionId,
      initiator: INITIATOR,
      route: {},
    });
    const surviving = snapshotOf("agent-310", executionMarker(executionId));
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
      conversationId: "C0RACE",
      externalThreadId: THREAD_TS,
      pendingExecutionId: executionId,
      initiator: INITIATOR,
      route: {},
    });
    const surviving = snapshotOf("agent-400", executionMarker(executionId));
    const { daemon, created } = makeFakeDaemon([surviving]);
    let lookups = 0;
    // Own-property override on a prototype chain: the store's methods (and its
    // `database` field, resolved through `store`) stay intact; only the first
    // `findThreadBinding` for the raced key reports the race window.
    const raceStore = Object.create(store) as ChannelStore;
    raceStore.findThreadBinding = async (
      organizationId,
      accountId,
      conversationId,
      externalThreadId,
    ) => {
      lookups += 1;
      if (lookups === 1 && externalThreadId === THREAD_TS) return undefined; // the race window
      return store.findThreadBinding(organizationId, accountId, conversationId, externalThreadId);
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
      makeRoute(),
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
