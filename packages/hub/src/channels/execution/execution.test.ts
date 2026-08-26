// COMPAT(clisbot-channels): targeted tests for the execution plane facade
// (plan §4-S2). Drives `createChannelPlane` end to end over the real ChannelStore
// (embedded PGlite) and a fake in-memory DaemonConnection: the kill switch, the
// first-mention bind, the shared stream consumer (permission events to the
// approval engine, turn events to the relay), start-time orphan recovery + the
// S10 posture assertion, and the approval-command short-circuit. The facade is
// the thin routing layer; these prove it composes the three engines correctly.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ChannelStore } from "../../db/channels.js";
import { embeddedDatabaseRuntime } from "../../db/runtime/index.js";
import type { DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentSnapshot,
  CreateAgentConfig,
} from "../daemon/types.js";
import type { DaemonConnection } from "../daemon/client.js";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import type { InboundMessage, PlaneLogger } from "../plane/types.js";
import { executionMarker } from "../bindings/index.js";
import { ApprovalPostureError } from "../policy.js";
import { createChannelPlane } from "../execution.js";

const ORGANIZATION_ID = "channel-org";
const ACCOUNT_ID = "work";
const INITIATOR = "slack:U0ALICE";
const SILENT: PlaneLogger = { warn: () => undefined, info: () => undefined };

// --- Fixtures --------------------------------------------------------------

const DEFAULTS: EffectiveDefaults = {
  requireMention: true,
  followUp: { mode: "auto", ttlMinutes: 60 },
  bindingKey: "thread",
  replyAnchor: "thread",
  sync: { finalAnswers: true, progress: false, toolCalls: false, threadLink: "final-only" },
};

// Kind-level match: any channel conversation resolves this route.
function makeRoute(overrides: { approval?: CompiledRoute["approval"] } = {}): CompiledRoute {
  return {
    match: { kind: "channel", ids: [] },
    target: { kind: "agent", agent: "worker", environment: "repo", template: null },
    defaultRoles: ["interactor"],
    assignments: [{ identities: [INITIATOR], roles: ["commandApprover"] }],
    defaults: DEFAULTS,
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
    setTimelineSubscription: async () => undefined,
    stop: () => undefined,
  };
  return { daemon, created, messages, responses };
}

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: "slack",
    accountId: ACCOUNT_ID,
    senderIdentity: INITIATOR,
    text: "start the build",
    mentionedBot: true,
    conversation: { kind: "channel", id: "C0APP", rootConversationId: "C0APP", threadId: null },
    ...overrides,
  };
}

interface FacadeHarness {
  plane: ReturnType<typeof createChannelPlane>;
  fake: ReturnType<typeof makeFakeDaemon>;
  posted: string[];
  next: { message: InboundMessage | null };
}

function makeHarness(
  opts: {
    envFlag?: boolean;
    account?: CompiledChannelAccount;
    controlPlane?: ChannelControlPlane;
  } = {},
): FacadeHarness {
  const account = opts.account ?? makeAccount(makeRoute());
  const controlPlane = opts.controlPlane ?? makeControlPlane(account);
  const fake = makeFakeDaemon();
  const posted: string[] = [];
  const next: { message: InboundMessage | null } = { message: null };
  const plane = createChannelPlane({
    organizationId: ORGANIZATION_ID,
    normalizeInbound: () => next.message,
    envFlag: opts.envFlag ?? true,
    controlPlane,
    logger: SILENT,
    post: async (p) => {
      posted.push(p.text);
      return { ok: true, nativeMessageId: "1720000000.000001" };
    },
    resolveAgentSpec: () => ({ provider: "codex", cwd: "/tmp/repo" }),
  });
  return { plane, fake, posted, next };
}

// --- Harness ---------------------------------------------------------------

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-execution-db-"));
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

// --- Tests -----------------------------------------------------------------

describe("kill switch (flag off)", () => {
  it("ingests nothing and binds nothing when isEnabled is false", async () => {
    const { plane, fake, posted, next } = makeHarness({ envFlag: false });
    await plane.start(fake.daemon, store);
    next.message = message({
      conversation: { kind: "channel", id: "C0OFF", rootConversationId: "C0OFF", threadId: null },
    });

    const result = await plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(result.dispatched, false);
    assert.equal(result.outcome?.kind, "ignored");
    assert.match(result.outcome?.kind === "ignored" ? result.outcome.reason : "", /kill switch/u);
    assert.equal(fake.created.length, 0, "no agent created with the flag off");
    assert.equal(posted.length, 0, "nothing relayed with the flag off");
  });
});

describe("first-mention bind (flag on)", () => {
  it("binds an agent, delivers the first prompt, and attaches the stream", async () => {
    const { plane, fake, next } = makeHarness();
    await plane.start(fake.daemon, store);
    next.message = message({
      conversation: { kind: "channel", id: "C0BIND", rootConversationId: "C0BIND", threadId: null },
    });

    const result = await plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });

    assert.equal(result.dispatched, true);
    assert.equal(result.outcome?.kind, "bound");
    const agentId = result.outcome?.kind === "bound" ? result.outcome.agentId : "";
    assert.equal(fake.created.length, 1, "one agent created");
    assert.equal(fake.messages.length, 1, "the first prompt delivered");
    assert.equal(fake.messages[0]?.text, "start the build");
    assert.equal(fake.messages[0]?.steer, false, "the first prompt does not steer");

    const binding = await store.findThreadBinding(ORGANIZATION_ID, ACCOUNT_ID, "C0BIND", null);
    assert.equal(binding?.status, "bound");
    assert.equal(binding?.agentId, agentId);
  });
});

describe("shared stream consumer", () => {
  async function bindAgent(conversationId: string) {
    const harness = makeHarness();
    await harness.plane.start(harness.fake.daemon, store);
    harness.next.message = message({
      conversation: {
        kind: "channel",
        id: conversationId,
        rootConversationId: conversationId,
        threadId: null,
      },
    });
    const result = await harness.plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(result.outcome?.kind, "bound");
    return {
      plane: harness.plane,
      posted: harness.posted,
      agentId: result.outcome?.kind === "bound" ? result.outcome.agentId : "",
    };
  }

  it("routes a permission_requested to the approval engine (prompt posted)", async () => {
    const { plane, posted, agentId } = await bindAgent("C0PERM");
    const request: AgentPermissionRequest = {
      id: "req-perm",
      provider: "codex",
      name: "Bash",
      kind: "tool",
      input: { command: "ls -la" },
    };

    await plane.onStreamEvent(agentId, {
      type: "permission_requested",
      provider: "codex",
      request,
    });

    assert.equal(posted.length, 1, "the approval prompt is posted in-thread");
    assert.match(posted[0] ?? "", /approve req-perm/u);
  });

  it("routes a turn to the relay (final answer posted)", async () => {
    const { plane, posted, agentId } = await bindAgent("C0RELAY");

    await plane.onStreamEvent(agentId, {
      type: "timeline",
      provider: "codex",
      item: { type: "assistant_message", text: "done" },
      turnId: "turn-1",
    });
    await plane.onStreamEvent(agentId, {
      type: "turn_completed",
      provider: "codex",
      turnId: "turn-1",
    });

    assert.ok(posted.includes("done"), "the final answer is relayed");
  });
});

describe("start-time recovery + posture", () => {
  it("recovers an orphan marker and re-attaches its stream", async () => {
    const executionId = "exec-recovery";
    await store.recordPendingThreadBinding({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      conversationId: "C0REC",
      externalThreadId: null,
      pendingExecutionId: executionId,
      initiator: INITIATOR,
      route: {},
    });
    const surviving = snapshotOf("agent-100", executionMarker(executionId));
    const { plane, posted } = makeHarness();

    const recovered = await plane.start(makeFakeDaemon([surviving]).daemon, store);

    assert.deepEqual(recovered, { rebound: 1, leftPending: 0 });

    // The recovered agent's stream is re-attached: a turn event relays into its thread.
    await plane.onStreamEvent("agent-100", {
      type: "timeline",
      provider: "codex",
      item: { type: "assistant_message", text: "still here" },
      turnId: "turn-rec",
    });
    await plane.onStreamEvent("agent-100", {
      type: "turn_completed",
      provider: "codex",
      turnId: "turn-rec",
    });
    assert.ok(posted.includes("still here"), "the re-attached stream relays the final answer");
  });

  it("asserts the S10 posture and rejects a posture-lifting route at start", async () => {
    const lax = makeRoute({ approval: [{ match: "*", mode: "auto-allow" }] });
    const { plane, fake } = makeHarness({ account: makeAccount(lax) });
    await assert.rejects(
      async () => plane.start(fake.daemon, store),
      (error: unknown) => error instanceof ApprovalPostureError,
      "a `*` auto-allow lifts the posture",
    );
  });
});

describe("approval-command short-circuit", () => {
  it("answers an in-thread prompt from the channel when the responder is authorized", async () => {
    const { plane, fake, next } = makeHarness();
    await plane.start(fake.daemon, store);
    const conversation: InboundMessage["conversation"] = {
      kind: "channel",
      id: "C0CMD",
      rootConversationId: "C0CMD",
      threadId: null,
    };
    next.message = message({ conversation });
    const bound = await plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    const agentId = bound.outcome?.kind === "bound" ? bound.outcome.agentId : "";

    // Open a prompt for a command-class tool (require, initiator-only).
    await plane.onStreamEvent(agentId, {
      type: "permission_requested",
      provider: "codex",
      request: {
        id: "req-cmd",
        provider: "codex",
        name: "Bash",
        kind: "tool",
        input: { command: "ls" },
      },
    });

    // The initiator answers in-thread.
    next.message = message({ text: "approve req-cmd", conversation });
    const answered = await plane.onInbound({
      channel: "slack",
      accountId: ACCOUNT_ID,
      ctxPayload: {},
    });
    assert.equal(answered.outcome?.kind, "command");
    assert.equal(answered.outcome?.kind === "command" ? answered.outcome.handled : false, true);

    const response = fake.responses.at(-1);
    assert.equal(response?.agentId, agentId);
    assert.equal(response?.requestId, "req-cmd");
    assert.equal(response?.response.behavior, "allow");
  });
});
