// The access plane on the production path: `createChannelPlane` over the real
// ChannelStore (embedded PGlite) and a fake daemon. Proves the four things a
// static read cannot — that a refused sender never reaches an agent and lands in
// channel activity, that pairing survives a replay, that a role gate stops the
// wrong person switching a conversation's model, and that neither an account nor
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
import type { InboundMessage, PlaneLogger, SupportedChannelName } from "../plane/types.js";
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
    discovery: { url: "ws://127.0.0.1:6767/ws", source: "default-port" },
    waitForConnected: async () => undefined,
    createAgent: async (config, opts) => {
      created.push({ config });
      const id = `agent-${(seq += 1)}`;
      const snapshot: AgentSnapshot = {
        id,
        provider: "codex",
        cwd: "/tmp/repo",
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

describe("command authority and target switching", () => {
  const MENU = { agents: ["reviewer"], models: ["gpt-5.6-luna"] };

  async function boundHarness(accountId: string) {
    const harness = makeHarness({ accountId, route: makeRoute({ selectable: MENU }) });
    await harness.plane.start(harness.daemon, store);
    // Alice starts the session, so she owns it; Bob is a plain member.
    await deliver(harness, dm({ senderIdentity: ALICE, accountId }));
    return harness;
  }

  it("refuses /stop and /model from a member who does not own the session", async () => {
    const harness = await boundHarness("authority");
    const stopped = await deliver(
      harness,
      dm({ senderIdentity: BOB, accountId: "authority", text: "/stop" }),
    );
    assert.equal(stopped.outcome?.kind === "command" && stopped.outcome.handled, false);
    assert.match(harness.posted.at(-1) ?? "", /needs owner or admin rights/u);
    assert.equal(harness.cancelled.length, 0);

    const switched = await deliver(
      harness,
      dm({ senderIdentity: BOB, accountId: "authority", text: "/model gpt-5.6-luna" }),
    );
    assert.equal(switched.outcome?.kind === "command" && switched.outcome.handled, false);
    await harness.plane.stop();
  });

  it("lets the session owner stop it", async () => {
    const harness = await boundHarness("owner-stop");
    const stopped = await deliver(
      harness,
      dm({ senderIdentity: ALICE, accountId: "owner-stop", text: "/stop" }),
    );
    assert.equal(stopped.outcome?.kind === "command" && stopped.outcome.handled, true);
    assert.equal(harness.cancelled.length, 1);
    await harness.plane.stop();
  });

  it("applies an admin's /model to the session the next message opens", async () => {
    const harness = await boundHarness("model-switch");
    const switched = await deliver(
      harness,
      dm({ senderIdentity: ALICE, accountId: "model-switch", text: "/model gpt-5.6-luna" }),
    );
    assert.equal(switched.outcome?.kind === "command" && switched.outcome.handled, true);
    assert.match(harness.posted.at(-1) ?? "", /Model set to gpt-5\.6-luna/u);
    assert.equal(harness.cancelled.length, 1, "the running session is ended by the switch");
    const selection = await store.access.findConversationSelection({
      organizationId: ORG_A,
      channel: "telegram",
      accountId: "model-switch",
      externalConversationId: "1001",
      externalThreadId: null,
    });
    assert.equal(selection?.selectedModel, "gpt-5.6-luna");
    assert.equal(selection?.selectedBy, ALICE);

    await deliver(harness, dm({ senderIdentity: ALICE, accountId: "model-switch" }));
    assert.equal(harness.created.length, 2);
    assert.equal(harness.created.at(-1)?.config.model, "gpt-5.6-luna");
    await harness.plane.stop();
  });

  it("routes the next session to an /agent choice", async () => {
    const harness = await boundHarness("agent-switch");
    await deliver(
      harness,
      dm({ senderIdentity: ALICE, accountId: "agent-switch", text: "/agent reviewer" }),
    );
    await deliver(harness, dm({ senderIdentity: ALICE, accountId: "agent-switch" }));
    assert.equal(harness.created.at(-1)?.config.title, "reviewer");
    await harness.plane.stop();
  });

  it("prints the menu for a bare verb and refuses a name outside it", async () => {
    const harness = await boundHarness("menu");
    await deliver(harness, dm({ senderIdentity: ALICE, accountId: "menu", text: "/model" }));
    assert.equal(harness.posted.at(-1), "Available models: gpt-5.6-luna.");
    await deliver(harness, dm({ senderIdentity: ALICE, accountId: "menu", text: "/agent nope" }));
    assert.equal(harness.posted.at(-1), "Unknown agent. Options: worker, reviewer.");
    assert.equal(harness.created.length, 1, "no switch, no new session");
    await harness.plane.stop();
  });

  it("shows the conversation's agent in /status", async () => {
    const harness = await boundHarness("status");
    await deliver(
      harness,
      dm({ senderIdentity: ALICE, accountId: "status", text: "/agent reviewer" }),
    );
    await deliver(harness, dm({ senderIdentity: ALICE, accountId: "status" }));
    await deliver(harness, dm({ senderIdentity: ALICE, accountId: "status", text: "/status" }));
    assert.match(harness.posted.at(-1) ?? "", /Route agent: reviewer/u);
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
