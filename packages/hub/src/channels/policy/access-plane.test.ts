import { configurationDaemonStub } from "../daemon/test-support.js";
// The access plane on the production path: `createChannelPlane` over the real
// ChannelStore (embedded PGlite) and a fake daemon. Proves the four things a
// static read cannot — that a refused sender never reaches an agent and lands in
// channel activity, that pairing survives a replay, that org Access gates commands and a same-provider model switch stays live, and that neither an account nor
// an organization leaks its allowlist to its neighbour.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ChannelStore, type RecordChannelInboundActivityInput } from "../../db/channels.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import type { AgentSnapshot, CreateAgentConfig } from "../daemon/types.js";
import type { DaemonConnection } from "../daemon/client.js";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveAccess,
  EffectiveDefaults,
} from "../config/compile.js";
import type {
  ChannelPlaneDeps,
  InboundMessage,
  PlaneLogger,
  SupportedChannelName,
} from "../plane/types.js";
import { createChannelPlane } from "../execution.js";

const ORG_A = "org-a";
const ORG_B = "org-b";
const ALICE = "telegram:1001";
const BOB = "telegram:1002";
const STRANGER = "telegram:9999";
const SILENT: PlaneLogger = { warn: () => undefined, info: () => undefined };

const DEFAULTS: EffectiveDefaults = {
  requireMention: true,
  followUp: { mode: "auto", ttlMinutes: 60 },
  bindingKey: "thread",
  replyAnchor: "default",
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

function makeRoute(options: {
  access?: EffectiveAccess;
  selectable?: CompiledRoute["selectable"];
  match?: CompiledRoute["match"];
}): CompiledRoute {
  return {
    match: options.match ?? { kind: "dm", ids: [] },
    target: { kind: "agent", agent: "worker", environment: "repo", template: null },
    defaultRoles: [],
    assignments: [
      { identities: [ALICE], roles: ["approver"] },
      { identities: [BOB], roles: ["interactor"] },
    ],
    defaults: options.access === undefined ? DEFAULTS : { ...DEFAULTS, access: options.access },
    approval: [{ match: "*", mode: "auto-deny" }],
    ...(options.selectable === undefined ? {} : { selectable: options.selectable }),
  };
}

function makeAccount(accountId: string, route: CompiledRoute): CompiledChannelAccount {
  return {
    channel: "telegram",
    accountId,
    enabled: true,
    channelEnabled: true,
    connectionId: `connection-${accountId}`,
    transport: {},
    config: {},
    defaultRoles: [],
    assignments: [],
    defaults: route.defaults,
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
      approver: {
        grants: ["bot.interact", "approval.command"],
        deny: [],
        extends: [],
        closure: ["approver"],
      },
    },
    users: {
      alice: { name: null, identities: [ALICE] },
      bob: { name: null, identities: [BOB] },
    },
    identityOwners: { [ALICE]: "alice", [BOB]: "bob" },
    assignments: [],
    defaults: DEFAULTS,
    approval: [],
    accounts: [account],
  } as unknown as ChannelControlPlane;
}

function dm(overrides: Partial<InboundMessage> = {}): InboundMessage {
  const sender = overrides.senderIdentity ?? ALICE;
  const peer = sender.slice("telegram:".length);
  return {
    channel: "telegram",
    accountId: "work",
    senderIdentity: sender,
    text: "hello",
    mentionedBot: true,
    conversation: { kind: "dm", id: peer, rootConversationId: peer, threadId: null },
    ...overrides,
  };
}

interface Harness {
  plane: ReturnType<typeof createChannelPlane>;
  daemon: DaemonConnection;
  next: { message: InboundMessage | null };
  posted: string[];
  created: { config: CreateAgentConfig }[];
  cancelled: string[];
  activity: RecordChannelInboundActivityInput[];
  agents: AgentSnapshot[];
}

function makeHarness(options: {
  organizationId?: string;
  accountId?: string;
  route: CompiledRoute;
  commandAccess?: ChannelPlaneDeps["commandAccess"];
  authorizeChannelUse?: ChannelPlaneDeps["authorizeChannelUse"];
}): Harness {
  const accountId = options.accountId ?? "work";
  const account = makeAccount(accountId, options.route);
  const created: { config: CreateAgentConfig }[] = [];
  const cancelled: string[] = [];
  const posted: string[] = [];
  const activity: RecordChannelInboundActivityInput[] = [];
  const agents: AgentSnapshot[] = [];
  const next: { message: InboundMessage | null } = { message: null };
  let seq = 0;
  const daemon: DaemonConnection = {
    ...configurationDaemonStub(),
    listProviderModels: async (provider) => [
      { provider, id: "gpt-default", label: "Default", isDefault: true },
      { provider, id: "gpt-5.6-luna", label: "Luna" },
    ],
    listProviderModes: async () => [
      { id: "auto-review", label: "Auto review", isUnattended: false },
    ],
    listAgentProfiles: async () => [
      {
        id: "reviewer",
        name: "Reviewer",
        provider: "codex",
        model: "gpt-5.6-luna",
        modeId: "auto-review",
      },
    ],
    applyAgentConfig: async (agentId, config) => {
      const agent = agents.find((entry) => entry.id === agentId);
      assert.ok(agent, "live config targets an existing agent");
      if (config.modelId != null) agent.model = config.modelId;
      if (config.thinkingOptionId != null) agent.thinkingOptionId = config.thinkingOptionId;
      if (config.modeId !== undefined) agent.modeId = config.modeId;
      if (config.featureValues !== undefined)
        agent.featureValues = { ...agent.featureValues, ...config.featureValues };
    },
    discovery: { url: "ws://127.0.0.1:6767/ws", source: "default-port" },
    waitForConnected: async () => undefined,
    createAgent: async (config, opts) => {
      created.push({ config });
      const id = `agent-${(seq += 1)}`;
      const snapshot: AgentSnapshot = {
        id,
        provider: config.provider,
        cwd: config.cwd,
        modeId: config.modeId ?? "auto-review",
        title: opts?.title ?? null,
        status: "idle",
        createdAt: "2026-09-07T00:00:00Z",
        updatedAt: "2026-09-07T00:00:00Z",
        labels: {},
        ...(config.model === undefined ? {} : { model: config.model }),
      };
      agents.push(snapshot);
      return { agentId: id, agent: snapshot };
    },
    sendAgentMessage: async () => undefined,
    cancelAgent: async (agentId) => {
      cancelled.push(agentId);
    },
    respondToAgentPermission: async () => undefined,
    listAgents: async () => agents,
    setTimelineSubscription: async () => undefined,
    stop: () => undefined,
  };
  const plane = createChannelPlane({
    organizationId: options.organizationId ?? ORG_A,
    accountScope: { channel: "telegram" as SupportedChannelName, accountId },
    normalizeInbound: () => next.message,
    envFlag: true,
    controlPlane: makeControlPlane(account),
    ...(options.authorizeChannelUse === undefined
      ? {}
      : { authorizeChannelUse: options.authorizeChannelUse }),
    commandAccess: options.commandAccess ?? {
      authorizeChannelPrivilege: async () => ({ allowed: true }),
      resolveChannelAgentConfigurations: async () => ({
        unrestricted: true,
        agentConfigurations: [],
      }),
      resolveChannelMember: async () => undefined,
    },
    recordChannelInboundActivity: async (input) => {
      activity.push(input);
    },
    dispatchWorkflow: async () => undefined,
    workflowOutputStore: {
      beginAgentExecutionOutput: async () => undefined,
      completeAgentExecutionOutput: async () => undefined,
      failAgentExecutionOutput: async () => false,
      findLatestChannelWorkflowExecution: async () => undefined,
    },
    logger: SILENT,
    post: async (params) => {
      posted.push(params.text);
      return { ok: true, externalMessageId: `ts-${posted.length}` };
    },
    resolveAgentSpec: (target, _defaults, _ref, _capability, overrides) => ({
      provider: "codex",
      cwd: "/tmp/repo",
      ...(overrides?.model === undefined ? {} : { model: overrides.model }),
      // The route's agent name rides the title so a test can see `/agent`.
      title: target.agent,
    }),
    resolveAgentAccessTarget: () => ({ daemonReference: "daemon-1", projectId: "project-1" }),
  });
  return { plane, daemon, next, posted, created, cancelled, activity, agents };
}

async function deliver(
  harness: Harness,
  message: InboundMessage,
  ctxPayload: Record<string, unknown> = {},
) {
  harness.next.message = message;
  return await harness.plane.onInbound({
    channel: "telegram",
    accountId: message.accountId,
    ctxPayload,
  } as never);
}

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-access-plane-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  for (const [id, slug] of [
    [ORG_A, "org-a"],
    [ORG_B, "org-b"],
  ]) {
    await bundle.runtime.query(`insert into organization (id, name, slug) values ($1, $2, $2)`, [
      id,
      slug,
    ]);
  }
  store = new ChannelStore(bundle.runtime);
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("allowlist enforcement", () => {
  it("refuses an unlisted sender before any turn, silently, and records it", async () => {
    const harness = makeHarness({
      route: makeRoute({ access: { dmPolicy: "allowlist", allowFrom: ["1001"] } }),
    });
    await harness.plane.start(harness.daemon, store);
    const refused = await deliver(harness, dm({ senderIdentity: STRANGER }));
    assert.equal(refused.dispatched, false);
    assert.equal(harness.created.length, 0);
    assert.equal(harness.posted.length, 0, "upstream refuses silently by default");
    const record = harness.activity.at(-1);
    assert.equal(record?.outcome, "denied");
    assert.equal(record?.outcomeDetail, "denied:dm_policy_not_allowlisted");
    assert.equal(record?.senderIdentity, STRANGER);
    await harness.plane.stop();
  });

  it("admits a listed sender", async () => {
    const harness = makeHarness({
      route: makeRoute({ access: { dmPolicy: "allowlist", allowFrom: ["1001"] } }),
    });
    await harness.plane.start(harness.daemon, store);
    const admitted = await deliver(harness, dm({ senderIdentity: ALICE }));
    assert.equal(admitted.outcome?.kind, "bound");
    assert.equal(harness.created.length, 1);
    await harness.plane.stop();
  });

  it("answers the refusal only when the route authored deniedReply", async () => {
    const harness = makeHarness({
      route: makeRoute({
        access: { dmPolicy: "allowlist", allowFrom: ["1001"], deniedReply: "Not for you." },
      }),
    });
    await harness.plane.start(harness.daemon, store);
    await deliver(harness, dm({ senderIdentity: STRANGER }));
    assert.deepEqual(harness.posted, ["Not for you."]);
    await harness.plane.stop();
  });

  it("leaves admission alone when no access block was authored", async () => {
    const harness = makeHarness({ route: makeRoute({}) });
    await harness.plane.start(harness.daemon, store);
    // BOB holds `bot.interact`, so the RBAC gate — the only gate here — admits.
    assert.equal((await deliver(harness, dm({ senderIdentity: BOB }))).outcome?.kind, "bound");
    await harness.plane.stop();
  });
});

describe("pairing", () => {
  it("issues one code, repeats itself to nobody, and admits after approval", async () => {
    const harness = makeHarness({
      accountId: "pairing",
      route: makeRoute({ access: { dmPolicy: "pairing" } }),
    });
    await harness.plane.start(harness.daemon, store);
    const first = await deliver(harness, dm({ senderIdentity: STRANGER, accountId: "pairing" }));
    assert.equal(first.dispatched, false);
    assert.equal(harness.posted.length, 1);
    const code = /\*\*([A-Z2-9]{6})\*\*/u.exec(harness.posted[0] ?? "")?.[1];
    assert.ok(code, `expected a pairing code in ${harness.posted[0]}`);
    assert.equal(harness.activity.at(-1)?.outcomeDetail, "pairing:dm_policy_pairing_required");

    // The durable queue can hand the same DM back: one code, one challenge.
    await deliver(harness, dm({ senderIdentity: STRANGER, accountId: "pairing" }));
    assert.equal(harness.posted.length, 1, "a repeat is not re-challenged");
    const pending = await store.access.listPairings({
      organizationId: ORG_A,
      channel: "telegram",
      accountId: "pairing",
    });
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.code, code);
    assert.equal(pending[0]?.status, "pending");

    await store.access.decidePairing({
      organizationId: ORG_A,
      channel: "telegram",
      accountId: "pairing",
      senderIdentity: STRANGER,
      decision: "approved",
    });
    const admitted = await deliver(harness, dm({ senderIdentity: STRANGER, accountId: "pairing" }));
    assert.equal(admitted.outcome?.kind, "bound");
    await harness.plane.stop();
  });

  it("never re-challenges a sender an operator denied", async () => {
    const harness = makeHarness({
      accountId: "denied",
      route: makeRoute({ access: { dmPolicy: "pairing" } }),
    });
    await harness.plane.start(harness.daemon, store);
    await deliver(harness, dm({ senderIdentity: STRANGER, accountId: "denied" }));
    await store.access.decidePairing({
      organizationId: ORG_A,
      channel: "telegram",
      accountId: "denied",
      senderIdentity: STRANGER,
      decision: "denied",
    });
    const posts = harness.posted.length;
    const refused = await deliver(harness, dm({ senderIdentity: STRANGER, accountId: "denied" }));
    assert.equal(refused.dispatched, false);
    assert.equal(harness.posted.length, posts, "a denied sender is not handed a new code");
    assert.equal(harness.activity.at(-1)?.outcome, "denied");
    await harness.plane.stop();
  });
});

describe("isolation", () => {
  it("keeps each account's allowlist and each organization's pairings to itself", async () => {
    const open = makeHarness({
      accountId: "open-account",
      route: makeRoute({ access: { dmPolicy: "allowlist", allowFrom: ["*"] } }),
    });
    const closed = makeHarness({
      accountId: "closed-account",
      route: makeRoute({ access: { dmPolicy: "allowlist", allowFrom: ["1001"] } }),
    });
    await open.plane.start(open.daemon, store);
    await closed.plane.start(closed.daemon, store);
    assert.equal(
      (await deliver(open, dm({ senderIdentity: STRANGER, accountId: "open-account" }))).outcome
        ?.kind,
      "bound",
    );
    assert.equal(
      (await deliver(closed, dm({ senderIdentity: STRANGER, accountId: "closed-account" })))
        .dispatched,
      false,
    );
    await open.plane.stop();
    await closed.plane.stop();

    // Organization A approved this sender on an identically named account.
    await store.access.decidePairing({
      organizationId: ORG_A,
      channel: "telegram",
      accountId: "shared-name",
      senderIdentity: STRANGER,
      decision: "approved",
    });
    await store.access.requestPairing({
      organizationId: ORG_A,
      channel: "telegram",
      accountId: "shared-name",
      senderIdentity: STRANGER,
      externalConversationId: "9999",
      code: "AAAAAA",
    });
    await store.access.decidePairing({
      organizationId: ORG_A,
      channel: "telegram",
      accountId: "shared-name",
      senderIdentity: STRANGER,
      decision: "approved",
    });
    const other = makeHarness({
      organizationId: ORG_B,
      accountId: "shared-name",
      route: makeRoute({ access: { dmPolicy: "pairing" } }),
    });
    await other.plane.start(other.daemon, store);
    const refused = await deliver(
      other,
      dm({ senderIdentity: STRANGER, accountId: "shared-name" }),
    );
    assert.equal(refused.dispatched, false, "org A's approval does not reach org B");
    assert.equal(
      await store.access
        .listApprovedPairedSenders({
          organizationId: ORG_B,
          channel: "telegram",
          accountId: "shared-name",
        })
        .then((rows) => rows.length),
      0,
    );
    await other.plane.stop();
  });
});

describe("org Access command authority and live configuration", () => {
  function conversationCommand(accountId: string, text: string, senderIdentity = ALICE) {
    return dm({
      accountId,
      text,
      senderIdentity,
      conversation: { kind: "group", id: "-200", rootConversationId: "-200", threadId: null },
    });
  }
  async function boundHarness(
    accountId: string,
    commandAccess?: ChannelPlaneDeps["commandAccess"],
  ) {
    const harness = makeHarness({
      accountId,
      // Everyone may use this shared conversation; command privileges remain independently gated.
      authorizeChannelUse: async () => ({ allowed: true }),
      route: makeRoute({
        match: { kind: "group", ids: ["-200"] },
        selectable: { models: ["legacy-route-model"], agents: [] },
      }),
      ...(commandAccess === undefined ? {} : { commandAccess }),
    });
    await harness.plane.start(harness.daemon, store);
    await deliver(harness, conversationCommand(accountId, "hello"));
    return harness;
  }

  it("allows another participant with agent.interact to control the bound session", async () => {
    const harness = await boundHarness("participant-control");
    const agentId = harness.agents[0]!.id;
    const stopped = await deliver(
      harness,
      conversationCommand("participant-control", "/stop", BOB),
    );
    assert.equal(stopped.outcome?.kind === "command" && stopped.outcome.handled, true);
    assert.deepEqual(harness.cancelled, [agentId]);
    await deliver(harness, conversationCommand("participant-control", "/model gpt-5.6-luna", BOB));
    assert.equal(harness.agents[0]?.model, "gpt-5.6-luna");
    assert.equal(harness.created.length, 1, "org Access replaces the initiator-owner gate");
    await harness.plane.stop();
  });

  it("refuses restricted Guests even when the route allows their conversation", async () => {
    const harness = await boundHarness("guest-command", {
      authorizeChannelPrivilege: async (request) =>
        request.senderIdentity === STRANGER
          ? { allowed: false, reason: "missing agent.interact" }
          : { allowed: true },
      resolveChannelAgentConfigurations: async () => ({
        unrestricted: true,
        agentConfigurations: [],
      }),
      resolveChannelMember: async () => undefined,
    });
    for (const text of ["/stop", "/model gpt-5.6-luna"]) {
      const result = await deliver(harness, conversationCommand("guest-command", text, STRANGER));
      assert.equal(result.outcome?.kind === "command" && result.outcome.handled, false);
    }
    assert.equal(harness.cancelled.length, 0);
    assert.equal(harness.agents[0]?.model, undefined);
    assert.match(harness.posted.at(-1) ?? "", /agent.interact/u);
    await harness.plane.stop();
  });

  it("applies the model live and keeps the concrete choice across /new", async () => {
    const harness = await boundHarness("live-model");
    const switched = await deliver(
      harness,
      conversationCommand("live-model", "/model gpt-5.6-luna"),
    );
    assert.equal(switched.outcome?.kind === "command" && switched.outcome.handled, true);
    assert.match(harness.posted.at(-1) ?? "", /model: gpt-5\.6-luna/u);
    assert.equal(harness.cancelled.length, 0);
    assert.equal(harness.created.length, 1);
    assert.equal(harness.agents[0]?.model, "gpt-5.6-luna");
    const selection = await store.access.findConversationSelection({
      organizationId: ORG_A,
      channel: "telegram",
      accountId: "live-model",
      externalConversationId: "-200",
      externalThreadId: null,
    });
    assert.equal(selection?.selectedModel, "gpt-5.6-luna");
    assert.equal(selection?.selectedProvider, "codex");
    assert.equal(selection?.selectedBy, ALICE);
    await deliver(harness, conversationCommand("live-model", "/new"));
    await deliver(harness, conversationCommand("live-model", "continue"));
    assert.equal(harness.created.length, 2);
    assert.equal(harness.created.at(-1)?.config.model, "gpt-5.6-luna");
    await harness.plane.stop();
  });

  it("applies daemon profiles without substituting the route's agent target", async () => {
    const harness = await boundHarness("profile");
    await deliver(harness, conversationCommand("profile", "/agent reviewer"));
    assert.equal(harness.agents[0]?.model, "gpt-5.6-luna");
    assert.equal(harness.created.length, 1);
    assert.equal(harness.cancelled.length, 0);
    await deliver(harness, conversationCommand("profile", "/new"));
    await deliver(harness, conversationCommand("profile", "continue"));
    assert.equal(harness.created.at(-1)?.config.title, "worker");
    assert.equal(harness.created.at(-1)?.config.model, "gpt-5.6-luna");
    await harness.plane.stop();
  });

  it("lists daemon catalog choices and refuses unknown profiles", async () => {
    const harness = await boundHarness("catalog-menu");
    await deliver(harness, conversationCommand("catalog-menu", "/model"));
    assert.match(harness.posted.at(-1) ?? "", /codex\/gpt-5\.6-luna/u);
    assert.doesNotMatch(harness.posted.at(-1) ?? "", /legacy-route-model/u);
    await deliver(harness, conversationCommand("catalog-menu", "/agent nope"));
    assert.match(harness.posted.at(-1) ?? "", /Unknown or ambiguous agent profile/u);
    assert.equal(harness.created.length, 1);
    await harness.plane.stop();
  });

  it("status reports the same live session after applying a profile", async () => {
    const harness = await boundHarness("profile-status");
    await deliver(harness, conversationCommand("profile-status", "/agent reviewer"));
    await deliver(harness, conversationCommand("profile-status", "/status"));
    assert.match(harness.posted.at(-1) ?? "", /Model: gpt-5\.6-luna/u);
    assert.equal(harness.created.length, 1);
    await harness.plane.stop();
  });
});

describe("mention mode", () => {
  it("runs a native command without a mention, but never a plain message", async () => {
    const harness = makeHarness({
      accountId: "mention",
      route: makeRoute({ match: { kind: "group", ids: [] } }),
    });
    await harness.plane.start(harness.daemon, store);
    const unmentioned = dm({
      senderIdentity: ALICE,
      accountId: "mention",
      mentionedBot: false,
      conversation: { kind: "group", id: "-100", rootConversationId: "-100", threadId: null },
    });
    const ignored = await deliver(harness, unmentioned);
    assert.equal(
      ignored.outcome?.kind === "ignored" ? ignored.outcome.reason : "",
      "not mentioned; requireMention is on",
    );
    assert.equal(harness.created.length, 0);

    // A `command`-family event carries no mention at all; an admitted sender's
    // command runs anyway — `requireMention` gates waking the agent, not control.
    const commanded = await deliver(
      harness,
      { ...unmentioned, text: "" },
      { EventKind: "command", EventFacts: { command: { name: "help" } } },
    );
    assert.equal(commanded.outcome?.kind === "command" && commanded.outcome.handled, true);
    await harness.plane.stop();
  });
});
