// The inbound half of the conversation flow
// (docs/features/channels/conversation-flow.md), driven through the real plane
// over the real ChannelStore (embedded PGlite): every message is a durable
// ingress row, as it is in production, so context and held messages are read
// back from the queue — including by a second plane after a "restart".
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ChannelStore } from "../../db/channels.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import { connectEnrolledChannelDaemon, type DaemonConnection } from "../daemon/client.js";
import type { AgentSnapshot } from "../daemon/types.js";
import { HostNotReachedError } from "../daemon/enrolled-client.js";
import { createMemorySteerTargets, type SteerTargetStore } from "../daemon/steer-target.js";
import { AgentRequestRefusedError } from "../daemon/agent-request-refusal.js";
import { configurationDaemonStub } from "../daemon/test-support.js";
import { channelMessageId } from "../daemon/session-operation.js";
import type { HeldFlushAdmission } from "../bindings/held-flush.js";
import { CONTEXT_HEADER, MESSAGE_HEADER, deliveryMessageId } from "../bindings/prompt.js";
import { claimedInbound } from "../ingress/claimed-inbound.js";
import type { InboundReplyParams } from "../loader/host.js";
import { ManualClock } from "../plane/clock.js";
import type { InboundMessage, PlaneLogger } from "../plane/types.js";
import { createChannelPlane } from "../execution.js";
import { BindingInbox, inboxBindingKey } from "../bindings/inbox.js";

const ORGANIZATION_ID = "flow-org";
const ACCOUNT_ID = "work";
const ALICE = "slack:U0ALICE";
const OUTSIDER = "slack:U0OUTSIDER";
const THREAD = "1712000000.000001";
const SILENT: PlaneLogger = { warn: () => undefined, info: () => undefined };

const DEFAULTS: EffectiveDefaults = {
  requireMention: true,
  followUp: { mode: "mention-only", ttlMinutes: 60 },
  bindingKey: "thread",
  replyAnchor: "default",
  outbound: { path: "relay", template: null },
  inbound: { reactionNotifications: "off", editNotifications: "off" },
  sync: {
    finalAnswers: true,
    progress: { progressMessage: false, typingIndicator: false, messageReaction: "off" },
    toolCalls: false,
    threadLink: "none",
    subagents: { finalAnswers: false, progress: false, toolCalls: false },
  },
};

function makeRoute(defaults: Partial<EffectiveDefaults>): CompiledRoute {
  return {
    audienceRules: [],
    where: { dm: false, groups: ["all"], conversations: [] },
    target: { kind: "agent", agent: "worker", environment: "repo", template: null },
    defaultRoles: ["interactor"],
    assignments: [],
    defaults: { ...DEFAULTS, ...defaults },
    approval: [{ match: "*", mode: "auto-deny" }],
  };
}

function makeControlPlane(routes: CompiledRoute | CompiledRoute[]): ChannelControlPlane {
  const route = Array.isArray(routes) ? routes[0]! : routes;
  const account: CompiledChannelAccount = {
    channel: "slack",
    accountId: ACCOUNT_ID,
    enabled: true,
    channelEnabled: true,
    connectionId: "connection-id",
    transport: {},
    config: {},
    defaultRoles: ["interactor"],
    assignments: [],
    defaults: route.defaults,
    approval: [],
    routes: Array.isArray(routes) ? routes : [route],
  };
  return {
    enabled: true,
    channelEnabled: {},
    roles: {
      interactor: { grants: ["bot.interact"], deny: [], extends: [], closure: ["interactor"] },
    },
    users: { alice: { name: "Alice", identities: [ALICE] } },
    identityOwners: { [ALICE]: "alice" },
    assignments: [],
    defaults: route.defaults,
    approval: [],
    accounts: [account],
  };
}

/** The daemon's receipt rule: a message id names one request, for good. */
function makeDaemon(
  options: { failSends?: number; onSend?: (agentId: string) => Promise<void> } = {},
) {
  const sends: { agentId: string; text: string; messageId: string }[] = [];
  const receipts = new Map<string, string>();
  let failures = options.failSends ?? 0;
  let seq = 0;
  const daemon: DaemonConnection = {
    ...configurationDaemonStub(),
    discovery: { url: "ws://127.0.0.1:6868/ws", source: "default-port" },
    waitForConnected: async () => undefined,
    createAgent: async () => {
      const id = `agent-${seq++}`;
      return {
        agentId: id,
        agent: {
          id,
          provider: "codex",
          cwd: "/tmp/repo",
          title: null,
          status: "idle",
          createdAt: "2026-09-22T00:00:00Z",
          updatedAt: "2026-09-22T00:00:00Z",
          labels: {},
        },
      };
    },
    sendAgentMessage: async (agentId, text, sendOptions) => {
      const messageId = sendOptions?.messageId ?? channelMessageId(sendOptions!.source!);
      const request = JSON.stringify([agentId, text]);
      const held = receipts.get(messageId);
      if (held !== undefined && held !== request) {
        throw new AgentRequestRefusedError("agent_request_key_conflict");
      }
      receipts.set(messageId, request);
      sends.push({ agentId, text, messageId });
      await options.onSend?.(agentId);
      if (failures > 0) {
        failures -= 1;
        throw new Error("the prompt's outcome is not known yet");
      }
    },
    cancelAgent: async () => undefined,
    respondToAgentPermission: async () => undefined,
    listAgents: async () => [],
    setTimelineSubscription: async () => undefined,
    stop: () => undefined,
  };
  return { daemon, sends };
}

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;
let threadSeq = 0;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-conversation-flow-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ($1, 'Flow Org', 'flow-org')`,
    [ORGANIZATION_ID],
  );
  store = new ChannelStore(bundle.runtime);
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

/** One test's conversation: a thread of its own, so tests never share a binding. */
function conversation() {
  threadSeq += 1;
  const thread = `${THREAD}${String(threadSeq).padStart(3, "0")}`;
  let messageSeq = 0;
  const conversationDetail = {
    kind: "thread" as const,
    id: thread,
    rootConversationId: "C0FLOW",
    threadId: thread,
  };
  return (text: string, from: { sender?: string; name?: string; mention?: boolean } = {}) => {
    messageSeq += 1;
    const message: InboundMessage = {
      channel: "slack",
      accountId: ACCOUNT_ID,
      senderIdentity: from.sender ?? ALICE,
      ...(from.name === undefined ? {} : { senderName: from.name }),
      text,
      mentionedBot: from.mention ?? true,
      externalMessageId: `${thread}${String(messageSeq).padStart(3, "0")}`,
      conversation: conversationDetail,
    };
    return message;
  };
}

function makePlane(
  route: CompiledRoute | CompiledRoute[],
  daemon: ReturnType<typeof makeDaemon>,
  options: { envFlag?: boolean; turnReconcileMs?: number } = {},
) {
  const clock = new ManualClock(1_000);
  const flushes: { admission: HeldFlushAdmission; id: string }[] = [];
  const posted: string[] = [];
  const postedThreads: (string | undefined)[] = [];
  const plane = createChannelPlane({
    organizationId: ORGANIZATION_ID,
    accountScope: { channel: "slack", accountId: ACCOUNT_ID },
    normalizeInbound: (params: InboundReplyParams) => {
      const stored = params.ctxPayload["Message"] as InboundMessage | undefined;
      const ingressId = params.ctxPayload["ClisbotInboundOperationId"];
      if (stored === undefined) return null;
      return typeof ingressId === "string" ? { ...stored, ingressId } : stored;
    },
    admitHeldFlush: async (admission) => {
      const { record } = await store.enqueueChannelIngress({
        organizationId: ORGANIZATION_ID,
        channel: "slack",
        accountId: ACCOUNT_ID,
        externalEventId: admission.externalEventId,
        externalMessageId: admission.externalEventId,
        externalConversationId: admission.externalConversationId,
        externalThreadId: admission.externalThreadId,
        laneKey: admission.laneKey,
        payload: admission.payload,
      });
      if (!flushes.some(({ id }) => id === record.id)) flushes.push({ admission, id: record.id });
    },
    envFlag: options.envFlag ?? true,
    controlPlane: makeControlPlane(route),
    dispatchWorkflow: async () => undefined,
    workflowOutputStore: {
      beginAgentExecutionOutput: async () => undefined,
      completeAgentExecutionOutput: async () => undefined,
      failAgentExecutionOutput: async () => false,
      findLatestChannelWorkflowExecution: async () => undefined,
    },
    clock,
    ...(options.turnReconcileMs === undefined ? {} : { turnReconcileMs: options.turnReconcileMs }),
    logger: SILENT,
    post: async (post) => {
      posted.push(post.text);
      postedThreads.push(post.threadId);
      return { ok: true, externalMessageId: "1720000000.000001" };
    },
    resolveAgentSpec: () => ({ provider: "codex", cwd: "/tmp/repo" }),
    resolveAgentAccessTarget: () => ({ daemonReference: "daemon-1", projectId: "project-1" }),
  });
  /** Admit one message durably, then hand the claimed row to the plane. */
  const send = async (message: InboundMessage) => {
    const payload = { channel: "slack", accountId: ACCOUNT_ID, ctxPayload: { Message: message } };
    const { record } = await store.enqueueChannelIngress({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalEventId: message.externalMessageId!,
      externalMessageId: message.externalMessageId!,
      externalConversationId: message.conversation.rootConversationId,
      externalThreadId: message.conversation.threadId,
      laneKey: `lane:${String(message.conversation.threadId)}`,
      payload,
    });
    const result = await plane.onInbound(claimedInbound(payload, record.id));
    return { result, record };
  };
  /** The drain handing the newest flush row to the plane. */
  const flush = async () => {
    const newest = flushes.at(-1);
    assert.ok(newest !== undefined, "a flush row was admitted");
    return plane.deliverHeld(newest.admission.payload, newest.id);
  };
  return { plane, send, flush, flushes, posted, postedThreads, sends: daemon.sends, clock };
}

const lines = (...rows: string[]) => rows.join("\n");

describe("the sender line", () => {
  it("names the sender in the first prompt and in every follow-up", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const live = makePlane(makeRoute({}), daemon);
    await live.plane.start(daemon.daemon, store);

    await live.send(say("start the build", { name: "Alice" }));
    await live.send(say("and the tests", { name: "Alice" }));

    assert.deepEqual(
      daemon.sends.map(({ text }) => text),
      ["Alice (slack:U0ALICE): start the build", "Alice (slack:U0ALICE): and the tests"],
    );
    await live.plane.stop();
  });
});

describe("context", () => {
  it("sends unmentioned messages once, before the next trigger, as quoted context", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const flow = makePlane(makeRoute({}), daemon);
    await flow.plane.start(daemon.daemon, store);

    const chatter = await flow.send(
      say("operator code is HH-HT", { name: "Lan", sender: OUTSIDER, mention: false }),
    );
    assert.equal(chatter.result.outcome?.kind, "ignored");
    await flow.send(say("create the card", { name: "Alice" }));
    await flow.send(say("second thought", { name: "Lan", sender: OUTSIDER, mention: false }));
    await flow.send(say("and close it", { name: "Alice" }));

    assert.deepEqual(
      daemon.sends.map(({ text }) => text),
      [
        lines(
          CONTEXT_HEADER,
          "Lan (slack:U0OUTSIDER): operator code is HH-HT",
          MESSAGE_HEADER,
          "Alice (slack:U0ALICE): create the card",
        ),
        lines(
          CONTEXT_HEADER,
          "Lan (slack:U0OUTSIDER): second thought",
          MESSAGE_HEADER,
          "Alice (slack:U0ALICE): and close it",
        ),
      ],
    );
    await flow.plane.stop();
  });

  it("keeps only senders the Route admits under allowed-senders, and nothing under none", async () => {
    for (const [unmentioned, expected] of [
      ["allowed-senders", ["Alice (slack:U0ALICE): from alice"]],
      ["none", []],
    ] as const) {
      const say = conversation();
      const daemon = makeDaemon();
      const flow = makePlane(makeRoute({ context: { unmentioned, maxMessages: 20 } }), daemon);
      await flow.plane.start(daemon.daemon, store);
      await flow.send(say("from alice", { name: "Alice", mention: false }));
      await flow.send(say("from outside", { name: "Lan", sender: OUTSIDER, mention: false }));
      await flow.send(say("go", { name: "Alice" }));

      const prompt = daemon.sends[0]!.text.split("\n");
      const context = prompt.includes(MESSAGE_HEADER)
        ? prompt.slice(1, prompt.indexOf(MESSAGE_HEADER))
        : [];
      assert.deepEqual(context, expected, unmentioned);
      await flow.plane.stop();
    }
  });

  it("caps the context at maxMessages, newest kept, and never repeats the older ones", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const flow = makePlane(makeRoute({ context: { maxMessages: 2 } }), daemon);
    await flow.plane.start(daemon.daemon, store);
    for (const text of ["one", "two", "three"]) await flow.send(say(text, { mention: false }));
    await flow.send(say("go"));
    await flow.send(say("again"));

    assert.deepEqual(daemon.sends[0]!.text.split("\n"), [
      CONTEXT_HEADER,
      "slack:U0ALICE: two",
      "slack:U0ALICE: three",
      MESSAGE_HEADER,
      "slack:U0ALICE: go",
    ]);
    assert.equal(daemon.sends[1]!.text, "slack:U0ALICE: again");
    await flow.plane.stop();
  });

  it("keeps each context line's sender name and handle across a restart", async () => {
    const say = conversation();
    const before = makeDaemon();
    const first = makePlane(makeRoute({}), before);
    await first.plane.start(before.daemon, store);
    await first.send({
      ...say("code is HH-HT", { name: "Lan", mention: false }),
      senderUsername: "lan",
    });
    await first.plane.stop();

    const after = makeDaemon();
    const second = makePlane(makeRoute({}), after);
    await second.plane.start(after.daemon, store);
    await second.send({ ...say("go", { name: "Minh" }), senderUsername: "minh" });
    assert.equal(
      after.sends[0]!.text,
      lines(
        CONTEXT_HEADER,
        "Lan (slack:U0ALICE, @lan): code is HH-HT",
        MESSAGE_HEADER,
        "Minh (slack:U0ALICE, @minh): go",
      ),
    );
    await second.plane.stop();
  });

  it("survives a restart: a new plane over the same database sends the kept context", async () => {
    const say = conversation();
    const before = makeDaemon();
    const first = makePlane(makeRoute({}), before);
    await first.plane.start(before.daemon, store);
    await first.send(say("kept across the restart", { mention: false }));
    await first.plane.stop();

    const after = makeDaemon();
    const second = makePlane(makeRoute({}), after);
    await second.plane.start(after.daemon, store);
    await second.send(say("go"));
    assert.equal(
      after.sends[0]!.text,
      lines(
        CONTEXT_HEADER,
        "slack:U0ALICE: kept across the restart",
        MESSAGE_HEADER,
        "slack:U0ALICE: go",
      ),
    );
    await second.plane.stop();
  });

  it("keeps a message whose session could not start as context for the next trigger", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const flow = makePlane(makeRoute({}), daemon);
    await flow.plane.start(daemon.daemon, store);
    const lost = say("this one failed");
    const payload = { channel: "slack", accountId: ACCOUNT_ID, ctxPayload: { Message: lost } };
    const { record } = await store.enqueueChannelIngress({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalEventId: lost.externalMessageId!,
      externalMessageId: lost.externalMessageId!,
      externalConversationId: "C0FLOW",
      externalThreadId: lost.conversation.threadId,
      laneKey: "lane:lost",
      payload,
    });

    await flow.plane.onDeadLettered(record);
    await flow.send(say("try again"));

    assert.deepEqual(flow.posted, [
      "This message could not be processed. Send another message to retry, and this one will be included.",
    ]);
    assert.equal(
      daemon.sends[0]!.text,
      lines(
        CONTEXT_HEADER,
        "slack:U0ALICE: this one failed",
        MESSAGE_HEADER,
        "slack:U0ALICE: try again",
      ),
    );
    await flow.plane.stop();
  });
});

describe("context across /new", () => {
  it("leaves what was kept before /new with the old conversation", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const flow = makePlane(makeRoute({}), daemon);
    await flow.plane.start(daemon.daemon, store);
    await flow.send(say("start"));
    await flow.send(say("old chatter", { mention: false }));
    await flow.send(say("/new"));
    await flow.send(say("fresh start"));

    assert.equal(daemon.sends.at(-1)!.text, "slack:U0ALICE: fresh start");
    await flow.plane.stop();
  });
});

const BATCH = { pauseSeconds: 60, maxWaitSeconds: 120, maxMessages: 2 };

describe("batching", () => {
  it("holds a burst and sends it as one prompt, keyed by its messages", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const flow = makePlane(makeRoute({ batching: BATCH }), daemon);
    await flow.plane.start(daemon.daemon, store);

    const first = say("first", { name: "Alice" });
    const second = say("second", { name: "Alice" });
    assert.equal((await flow.send(first)).result.outcome?.kind, "held");
    assert.equal(flow.flushes.length, 0, "the pause has not passed");
    const held = await flow.send(second);
    assert.equal(held.result.outcome?.kind, "held");
    assert.equal(flow.flushes.length, 1, "maxMessages sends at once");
    assert.equal(daemon.sends.length, 0, "no drain worker sent anything while holding");

    assert.equal(await flow.flush(), undefined);
    assert.deepEqual(daemon.sends, [
      {
        agentId: "agent-0",
        text: lines("Alice (slack:U0ALICE): first", "Alice (slack:U0ALICE): second"),
        messageId: deliveryMessageId([first, second]),
      },
    ]);
    // Delivered once: the same flush row replayed finds nothing held.
    assert.equal(await flow.flush(), undefined);
    assert.equal(daemon.sends.length, 1);
    await flow.plane.stop();
  });

  it("replays a failed batch as the same request", async () => {
    const say = conversation();
    const daemon = makeDaemon({ failSends: 1 });
    const flow = makePlane(makeRoute({ batching: BATCH }), daemon);
    await flow.plane.start(daemon.daemon, store);
    await flow.send(say("one"));
    await flow.send(say("two"));

    await assert.rejects(flow.flush());
    await flow.flush();

    assert.equal(daemon.sends.length, 2, "sent, then replayed");
    assert.deepEqual(daemon.sends[1], daemon.sends[0], "same session, text and receipt key");
    await flow.plane.stop();
  });

  it("is off when the Route says off, whatever the account said", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const flow = makePlane(makeRoute({ batching: "off" }), daemon);
    await flow.plane.start(daemon.daemon, store);
    assert.equal((await flow.send(say("now"))).result.outcome?.kind, "bound");
    await flow.plane.stop();
  });

  it("sends what a previous run held when the plane starts again", async () => {
    const say = conversation();
    const before = makeDaemon();
    const first = makePlane(makeRoute({ batching: BATCH }), before);
    await first.plane.start(before.daemon, store);
    await first.send(say("held over the restart"));
    assert.equal(first.flushes.length, 0);
    await first.plane.stop();

    const after = makeDaemon();
    const second = makePlane(makeRoute({ batching: BATCH }), after);
    await second.plane.start(after.daemon, store);
    const recovered = second.flushes.find(
      ({ admission }) =>
        admission.externalConversationId === "C0FLOW" &&
        admission.externalThreadId === say("probe").conversation.threadId,
    );
    assert.ok(recovered !== undefined, "start re-admits the flush");
    await second.plane.deliverHeld(recovered.admission.payload, recovered.id);
    assert.deepEqual(
      after.sends.map(({ text }) => text),
      ["slack:U0ALICE: held over the restart"],
    );
    await second.plane.stop();
  });
});

describe("whenBusy", () => {
  it("queues a message behind the running turn and sends it when the turn ends", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const flow = makePlane(makeRoute({ whenBusy: "queue" }), daemon);
    await flow.plane.start(daemon.daemon, store);

    const bound = await flow.send(say("start"));
    assert.equal(bound.result.outcome?.kind, "bound");
    assert.equal((await flow.send(say("also this"))).result.outcome?.kind, "held");
    assert.equal((await flow.send(say("and this"))).result.outcome?.kind, "held");
    assert.equal(flow.flushes.length, 0, "held while the turn runs");

    await flow.plane.onStreamEvent("agent-0", {
      type: "turn_completed",
      provider: "codex",
      turnId: "turn-1",
    });
    assert.equal(flow.flushes.length, 1);
    await flow.flush();
    assert.deepEqual(
      daemon.sends.map(({ text }) => text),
      ["slack:U0ALICE: start", lines("slack:U0ALICE: also this", "slack:U0ALICE: and this")],
    );
    await flow.plane.stop();
  });

  it("steers into the running turn by default", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const flow = makePlane(makeRoute({}), daemon);
    await flow.plane.start(daemon.daemon, store);
    await flow.send(say("start"));
    assert.equal((await flow.send(say("keep going"))).result.outcome?.kind, "steered");
    await flow.plane.stop();
  });
});

// --- Review regressions ----------------------------------------------------

async function rowOf(id: string) {
  const rows = await store.listChannelIngress({ organizationId: ORGANIZATION_ID, limit: 1_000 });
  const row = rows.find((candidate) => candidate.id === id);
  assert.ok(row !== undefined);
  return row;
}

describe("review regressions", () => {
  it("does not hold behind a turn that ended before its send returned", async () => {
    const say = conversation();
    const hooks: { onSend?: ((agentId: string) => Promise<void>) | undefined } = {};
    const daemon = makeDaemon({
      onSend: (agentId) => hooks.onSend?.(agentId) ?? Promise.resolve(),
    });
    const flow = makePlane(makeRoute({ whenBusy: "queue" }), daemon);
    await flow.plane.start(daemon.daemon, store);
    // A fast finish: the terminal event lands inside the send.
    hooks.onSend = (agentId) =>
      flow.plane.onStreamEvent(agentId, { type: "turn_completed", provider: "codex", turnId: "t" });

    assert.equal((await flow.send(say("start"))).result.outcome?.kind, "bound");
    hooks.onSend = undefined;
    assert.equal((await flow.send(say("next"))).result.outcome?.kind, "steered");
    await flow.plane.stop();
  });

  it("settles only the context rows a prompt read", async () => {
    const say = conversation();
    const route = makeRoute({});
    const inbox = new BindingInbox({
      store: store.inbox,
      organizationId: ORGANIZATION_ID,
      readMessage: () => null,
    });
    const admit = async (message: InboundMessage) => {
      const { record } = await store.enqueueChannelIngress({
        organizationId: ORGANIZATION_ID,
        channel: "slack",
        accountId: ACCOUNT_ID,
        externalEventId: message.externalMessageId!,
        externalMessageId: message.externalMessageId!,
        externalConversationId: "C0FLOW",
        externalThreadId: message.conversation.threadId,
        laneKey: "lane:other",
        payload: {},
      });
      return { ...message, ingressId: record.id };
    };
    const late = await admit(say("filed after the read", { mention: false }));
    const trigger = await admit(say("go"));
    const prepared = await inbox.prepare({ message: trigger }, route);
    // Another lane files an older row between the read and the settle.
    await inbox.keepUnmentioned(late, route, async () => true);
    await prepared.settle();

    assert.equal((await rowOf(late.ingressId)).inboxState, "context", "waits for the next prompt");
    assert.equal((await rowOf(trigger.ingressId)).inboxState, "delivered");
  });

  it("files a dead-lettered message under the binding that served it", async () => {
    const say = conversation();
    const channelWide = { ...makeRoute({ bindingKey: "channel" }), defaultRoles: [] };
    const daemon = makeDaemon();
    const flow = makePlane([channelWide, makeRoute({})], daemon);
    await flow.plane.start(daemon.daemon, store);
    const lost = say("lost in the thread");
    const payload = { channel: "slack", accountId: ACCOUNT_ID, ctxPayload: { Message: lost } };
    const { record } = await store.enqueueChannelIngress({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalEventId: lost.externalMessageId!,
      externalMessageId: lost.externalMessageId!,
      externalConversationId: "C0FLOW",
      externalThreadId: lost.conversation.threadId,
      laneKey: "lane:served",
      payload,
    });

    await flow.plane.onDeadLettered(record);
    await flow.send(say("again"));
    assert.equal(
      daemon.sends[0]!.text,
      lines(
        CONTEXT_HEADER,
        "slack:U0ALICE: lost in the thread",
        MESSAGE_HEADER,
        "slack:U0ALICE: again",
      ),
    );
    await flow.plane.stop();
  });

  it("never includes a timed-out message as context even without sentIn", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const flow = makePlane(makeRoute({}), daemon);
    await flow.plane.start(daemon.daemon, store);
    try {
      const lost = say("possibly already executed");
      const { record } = await store.enqueueChannelIngress({
        organizationId: ORGANIZATION_ID,
        channel: "slack",
        accountId: ACCOUNT_ID,
        externalEventId: lost.externalMessageId!,
        externalMessageId: lost.externalMessageId!,
        externalConversationId: "C0FLOW",
        externalThreadId: lost.conversation.threadId,
        laneKey: "lane:unknown",
        payload: { channel: "slack", accountId: ACCOUNT_ID, ctxPayload: { Message: lost } },
      });
      await flow.plane.onDeadLettered({ ...record, failedReason: "dispatch-outcome-unknown" });
      await flow.send(say("next"));
      assert.equal((await rowOf(record.id)).inboxState, "delivered");
      assert.equal(daemon.sends.at(-1)!.text, "slack:U0ALICE: next");
      assert.deepEqual(flow.posted, [
        "Processing stopped before its outcome could be confirmed. It was not retried automatically. Check the session before sending this message again.",
      ]);
    } finally {
      await flow.plane.stop();
    }
  });

  it("never resends as context a message a prompt already carried", async () => {
    const say = conversation();
    const daemon = makeDaemon({ failSends: 1 });
    const flow = makePlane(makeRoute({}), daemon);
    await flow.plane.start(daemon.daemon, store);
    const first = say("outcome unknown");
    const attempt = await flow.send(first).catch((error: unknown) => error);
    assert.ok(attempt instanceof Error, "the send failed after reaching the daemon");
    const payload = { channel: "slack", accountId: ACCOUNT_ID, ctxPayload: { Message: first } };
    const rows = await store.listChannelIngress({ organizationId: ORGANIZATION_ID, limit: 1_000 });
    const record = rows.find((row) => row.externalMessageId === first.externalMessageId)!;
    assert.notEqual(record.sentIn, null);

    await flow.plane.onDeadLettered({ ...record, payload });
    await flow.send(say("next"));
    assert.deepEqual(flow.posted, ["This message could not be processed. Send it again."]);
    assert.equal(daemon.sends.at(-1)!.text, "slack:U0ALICE: next");
    await flow.plane.stop();
  });

  it("brings a flush back when the account is not serving, and keeps the rows held", async () => {
    const say = conversation();
    const before = makeDaemon();
    const holding = makePlane(makeRoute({ batching: BATCH }), before);
    await holding.plane.start(before.daemon, store);
    const held = await holding.send(say("held"));
    await holding.send(say("held too"));
    await holding.plane.stop();

    const after = makeDaemon();
    const off = makePlane(makeRoute({ batching: BATCH }), after, { envFlag: false });
    await off.plane.start(after.daemon, store);
    const flush = holding.flushes.at(-1)!;
    const deferral = await off.plane.deliverHeld(flush.admission.payload, flush.id);

    assert.equal(deferral?.retryAfterMs, 60_000);
    assert.equal((await rowOf(held.record.id)).inboxState, "held");
    assert.equal(after.sends.length, 0);
    await off.plane.stop();
  });
});

// --- Second review regressions ----------------------------------------------

const payloadOf = (message: InboundMessage) => ({
  channel: "slack",
  accountId: ACCOUNT_ID,
  ctxPayload: { Message: message },
});

async function admitOnly(message: InboundMessage) {
  const { record } = await store.enqueueChannelIngress({
    organizationId: ORGANIZATION_ID,
    channel: "slack",
    accountId: ACCOUNT_ID,
    externalEventId: message.externalMessageId!,
    externalMessageId: message.externalMessageId!,
    externalConversationId: message.conversation.rootConversationId,
    externalThreadId: message.conversation.threadId,
    laneKey: `lane:${String(message.conversation.threadId)}`,
    payload: payloadOf(message),
  });
  return record;
}

describe("second review regressions", () => {
  it("completes a replay of a delivered message without a second prompt", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const flow = makePlane(makeRoute({}), daemon);
    await flow.plane.start(daemon.daemon, store);
    await flow.send(say("kept", { mention: false }));
    const trigger = say("go");
    const sent = await flow.send(trigger);

    // The queue lost the completion: the drain hands the same row over again.
    const replay = await flow.plane.onInbound(claimedInbound(payloadOf(trigger), sent.record.id));
    assert.equal(replay.outcome?.kind, "ignored");
    assert.equal(daemon.sends.length, 1, "no second prompt");
    await flow.plane.stop();
  });

  it("never resends the context a prompt with an unknown outcome carried", async () => {
    const say = conversation();
    const daemon = makeDaemon({ failSends: 1 });
    const flow = makePlane(makeRoute({}), daemon);
    await flow.plane.start(daemon.daemon, store);
    const kept = await flow.send(say("carried once", { mention: false }));
    const first = say("go");
    await assert.rejects(flow.send(first));
    const trigger = await rowOf(
      (await store.listChannelIngress({ organizationId: ORGANIZATION_ID, limit: 1_000 })).find(
        (row) => row.externalMessageId === first.externalMessageId,
      )!.id,
    );

    await flow.plane.onDeadLettered(trigger);
    assert.notEqual((await rowOf(kept.record.id)).sentIn, null);
    await flow.send(say("next"));
    assert.equal(daemon.sends.at(-1)!.text, "slack:U0ALICE: next");
    await flow.plane.stop();
  });

  it("never strands held messages when their flush reaches no session", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const flow = makePlane(makeRoute({ batching: BATCH }), daemon);
    await flow.plane.start(daemon.daemon, store);
    const first = await flow.send(say("one"));
    await flow.send(say("two"));
    // The binding was abandoned between the hold and the flush.
    const binding = {
      organizationId: ORGANIZATION_ID,
      accountId: ACCOUNT_ID,
      externalConversationId: "C0FLOW",
      externalThreadId: say("probe").conversation.threadId,
    };
    await store.recordPendingThreadBinding({
      ...binding,
      channel: "slack",
      pendingExecutionId: "lost-create",
      initiator: ALICE,
      route: {},
    });
    await store.abandonPendingThreadBinding({ ...binding, resolvedAt: new Date() });

    await flow.flush();
    assert.equal(daemon.sends.length, 0);
    assert.equal((await rowOf(first.record.id)).inboxState, "context", "kept for the next trigger");
    await flow.plane.stop();
  });

  it("retries a batch with exactly the messages its first attempt carried", async () => {
    const say = conversation();
    const daemon = makeDaemon({ failSends: 1 });
    const flow = makePlane(makeRoute({ batching: BATCH }), daemon);
    await flow.plane.start(daemon.daemon, store);
    await flow.send(say("one"));
    const late = await admitOnly(say("from another lane"));
    await flow.send(say("two"));
    await assert.rejects(flow.flush());
    // Another lane files an older message held between the two attempts.
    const scope = {
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      bindingKey: inboxBindingKey({
        externalConversationId: "C0FLOW",
        externalThreadId: say("probe").conversation.threadId,
      }),
    };
    await store.inbox.file(scope, [late.id], "held");
    const flushesBefore = flow.flushes.length;

    await flow.flush();
    assert.deepEqual(daemon.sends[1], daemon.sends[0], "the same request, not a superset");
    assert.equal((await rowOf(late.id)).inboxState, "held", "left for its own flush");
    assert.equal(flow.flushes.length, flushesBefore + 1, "which is admitted at once");
    await flow.plane.stop();
  });
});

const REPLY_UNCONFIRMED_NOTICE =
  "The connection to the machine that runs this bot was interrupted during this turn, so the reply here may be incomplete. Check the session for the full result. Nothing was sent again.";

const HOST_LOST_NOTICE =
  "The machine that runs this bot went away while it was working on this message, so an answer may never come. Send it again if you do not get one.";

describe("a Host that goes away mid-turn", () => {
  it("tells each conversation whose turn it took, once, and retries nothing", async () => {
    const daemon = makeDaemon();
    const flow = makePlane(makeRoute({}), daemon);
    await flow.plane.start(daemon.daemon, store);
    const first = conversation();
    const second = conversation();
    const running = await flow.send(first("thả like trên tin này"));
    await flow.send(second("3+3"));
    // A third conversation whose turn ended before the drop hears nothing.
    const done = conversation();
    const ended = await flow.send(done("done already"));
    const endedAgent = ended.result.outcome?.kind === "bound" ? ended.result.outcome.agentId : "";
    await flow.plane.onStreamEvent(endedAgent, {
      type: "turn_completed",
      provider: "codex",
      turnId: "t",
    });

    await flow.plane.onHostLost();
    assert.deepEqual(flow.posted, [HOST_LOST_NOTICE, HOST_LOST_NOTICE], "one notice per turn");
    assert.deepEqual(
      flow.postedThreads.toSorted(),
      [first("probe").conversation.threadId, second("probe").conversation.threadId].toSorted(),
    );

    // The Host came back and the turn had finished after all: its late
    // terminal event adds no second word (the relay posts the answer itself).
    const runningAgent =
      running.result.outcome?.kind === "bound" ? running.result.outcome.agentId : "";
    await flow.plane.onStreamEvent(runningAgent, {
      type: "turn_completed",
      provider: "codex",
      turnId: "late",
    });
    assert.equal(flow.posted.length, 2);
    // A second drop after the reconnect says nothing about the old turns.
    await flow.plane.onHostLost();
    assert.equal(flow.posted.length, 2);
    // The message was delivered: its row stays completed, never retried.
    assert.equal((await rowOf(running.record.id)).inboxState, "delivered");
    assert.equal(daemon.sends.length, 3);
    await flow.plane.stop();
  });

  it("tells a turn the Host finished unseen, once, that its reply may be incomplete, never that the machine went away", async () => {
    // 2026-11-03: the turn's stream was cut, so its terminal event never came.
    // A day later a Host restart told the thread the machine went away while
    // it was working. Independent of the Route's progress settings.
    const indicatorOn = {
      ...DEFAULTS.sync,
      progress: { ...DEFAULTS.sync.progress, typingIndicator: true },
    };
    for (const sync of [DEFAULTS.sync, indicatorOn]) {
      const say = conversation();
      const daemon = makeDaemon();
      const host = readsOf(daemon.daemon);
      const flow = makePlane(makeRoute({ sync }), daemon, { turnReconcileMs: 10 });
      await flow.plane.start(daemon.daemon, store);
      host.answer = async () => [];
      await flow.send(say("check the refresh logic"));
      const before = host.reads;
      await waitFor(() => host.reads > before);
      await pause(30);

      await flow.plane.onHostLost();
      await pause(30);
      assert.deepEqual(
        flow.posted,
        [REPLY_UNCONFIRMED_NOTICE],
        `typing indicator ${sync.progress.typingIndicator}`,
      );
      await flow.plane.stop();
    }
  });

  it("keeps a turn that started while the Host's idle answer was on its way", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const host = readsOf(daemon.daemon);
    const flow = makePlane(makeRoute({}), daemon, { turnReconcileMs: 10 });
    await flow.plane.start(daemon.daemon, store);
    host.answer = async () => [runningSnapshot("agent-0")];
    const first = await flow.send(say("first"));
    assert.equal(first.result.outcome?.kind === "bound" && first.result.outcome.agentId, "agent-0");

    // The Host answers "idle" from before the follow-up started a new turn.
    let release!: (agents: AgentSnapshot[]) => void;
    const stale = new Promise<AgentSnapshot[]>((resolve) => {
      release = resolve;
    });
    host.answer = () => stale;
    const asked = host.reads;
    await waitFor(() => host.reads > asked);
    await flow.send(say("and the follow-up"));
    host.answer = async () => [runningSnapshot("agent-0")];
    release([]);
    // Several more reconcile rounds, each reading "running".
    await pause(60);

    await flow.plane.onHostLost();
    assert.deepEqual(flow.posted, [HOST_LOST_NOTICE], "the new turn is still running");
    await flow.plane.stop();
  });

  it("keeps a turn when the app or another account starts one while the idle answer is on its way", async () => {
    // The new turn never passes through this plane's sends: only its stream says so.
    const say = conversation();
    const daemon = makeDaemon();
    const host = readsOf(daemon.daemon);
    const flow = makePlane(makeRoute({}), daemon, { turnReconcileMs: 10 });
    await flow.plane.start(daemon.daemon, store);
    host.answer = async () => [runningSnapshot("agent-0")];
    await flow.send(say("first"));

    let release!: (agents: AgentSnapshot[]) => void;
    const stale = new Promise<AgentSnapshot[]>((resolve) => {
      release = resolve;
    });
    host.answer = () => stale;
    const asked = host.reads;
    await waitFor(() => host.reads > asked);
    await flow.plane.onStreamEvent("agent-0", {
      type: "turn_started",
      provider: "codex",
      turnId: "started-from-the-app",
    });
    host.answer = async () => [runningSnapshot("agent-0")];
    release([]);
    await pause(60);

    await flow.plane.onHostLost();
    assert.deepEqual(flow.posted, [HOST_LOST_NOTICE], "the idle answer predates the app's turn");
    await flow.plane.stop();
  });

  it("keeps a turn while a send is still on its way to the Host", async () => {
    const say = conversation();
    let release!: () => void;
    let holding = false;
    const daemon = makeDaemon({
      onSend: async () => {
        if (!holding) return;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    const host = readsOf(daemon.daemon);
    const flow = makePlane(makeRoute({}), daemon, { turnReconcileMs: 10 });
    await flow.plane.start(daemon.daemon, store);
    host.answer = async () => [runningSnapshot("agent-0")];
    await flow.send(say("first"));
    holding = true;
    const followUp = flow.send(say("still sending"));
    await waitFor(() => daemon.sends.length === 2);
    host.answer = async () => [];
    const before = host.reads;
    await pause(60);

    await flow.plane.onHostLost();
    assert.deepEqual(flow.posted, [HOST_LOST_NOTICE], "nothing ended while a send was open");
    assert.ok(host.reads >= before + 2, "the Host was asked while the send was open");
    release();
    await followUp;
    await flow.plane.stop();
  });

  it("ends nothing when the Host's status cannot be read", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const host = readsOf(daemon.daemon);
    const flow = makePlane(makeRoute({}), daemon, { turnReconcileMs: 10 });
    await flow.plane.start(daemon.daemon, store);
    host.answer = async () => {
      throw new Error("host_not_connected");
    };
    await flow.send(say("long task"));
    const before = host.reads;
    await waitFor(() => host.reads >= before + 2);

    await flow.plane.onHostLost();
    assert.deepEqual(flow.posted, [HOST_LOST_NOTICE]);
    await flow.plane.stop();
  });

  it("tells a turn that ran through a brief disconnect, once, when it ends", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const host = readsOf(daemon.daemon);
    const flow = makePlane(makeRoute({}), daemon, { turnReconcileMs: 10 });
    await flow.plane.start(daemon.daemon, store);
    host.answer = async () => [runningSnapshot("agent-0")];
    await flow.send(say("long task"));
    flow.plane.onHostReconnected();

    const completed = { type: "turn_completed" as const, provider: "codex", turnId: "t" };
    await flow.plane.onStreamEvent("agent-0", completed);
    await flow.plane.onStreamEvent("agent-0", completed);
    assert.deepEqual(flow.posted, [REPLY_UNCONFIRMED_NOTICE]);
    await flow.plane.onHostLost();
    assert.deepEqual(flow.posted, [REPLY_UNCONFIRMED_NOTICE]);
    await flow.plane.stop();
  });

  it("says nothing extra for a turn whose stream arrived whole", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const host = readsOf(daemon.daemon);
    const flow = makePlane(makeRoute({}), daemon, { turnReconcileMs: 10 });
    await flow.plane.start(daemon.daemon, store);
    host.answer = async () => [runningSnapshot("agent-0")];
    await flow.send(say("short task"));
    await flow.plane.onStreamEvent("agent-0", {
      type: "turn_completed",
      provider: "codex",
      turnId: "t",
    });
    // A reconnect after the turn ended marks nothing.
    flow.plane.onHostReconnected();
    host.answer = async () => [];
    await pause(40);
    assert.deepEqual(flow.posted, []);
    await flow.plane.stop();
  });

  it("says nothing when the Hub itself stops the plane", async () => {
    const say = conversation();
    const daemon = makeDaemon();
    const flow = makePlane(makeRoute({}), daemon);
    await flow.plane.start(daemon.daemon, store);
    await flow.send(say("still running"));

    await flow.plane.stop();
    await flow.plane.onHostLost();
    assert.deepEqual(flow.posted, []);
  });
});

/** Count the Host's status reads and choose each answer. */
function readsOf(daemon: DaemonConnection) {
  const host = {
    reads: 0,
    answer: async (): Promise<AgentSnapshot[]> => [],
  };
  daemon.listAgents = () => {
    host.reads += 1;
    return host.answer();
  };
  return host;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function runningSnapshot(id: string): AgentSnapshot {
  return {
    id,
    provider: "codex",
    cwd: "/tmp/repo",
    title: null,
    status: "running",
    createdAt: "2026-09-22T00:00:00Z",
    updatedAt: "2026-09-22T00:00:00Z",
    labels: {},
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the Host");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A Host with the input queue, as the daemon behaves: a strict Steer names the
 * running turn or none while idle, and each message id keeps one receipt whose
 * fingerprint includes the turn (`server/message-receipts`). From 2.2.2 a Steer
 * refused before delivery frees its receipt; `beforeV222` keeps it.
 */
class StrictHost {
  beforeV222 = false;
  turn: string | null = null;
  /** Runs between the Hub reading the turn and its send arriving. */
  beforeSend: (() => void) | undefined;
  /** Commit the next send, then drop the socket before answering it. */
  loseNextAnswer = false;
  /** Commit the next send and leave it unanswered until `dropConnections`. */
  holdNextAnswer = false;
  /** Every connection finds the Host away: calls fail before anything is written. */
  away = false;
  readonly delivered: { messageId: string; turn: string | null }[] = [];
  /** Every send that reached the Host, delivered or not. */
  readonly attempts: string[] = [];
  private readonly receipts = new Map<string, { fingerprint: string; completed: boolean }>();
  private readonly handlers = new Set<(message: Record<string, unknown>) => void>();
  private readonly disconnects = new Set<() => void>();
  private turnSeq = 0;

  startTurn(): string {
    this.turnSeq += 1;
    this.turn = `turn-${this.turnSeq}`;
    return this.turn;
  }

  /** The Host's socket drops: what is in flight on it gets no answer. */
  dropConnections(): void {
    for (const disconnect of this.disconnects) disconnect();
  }

  deliveriesOf(messageId: string) {
    return this.delivered.filter((entry) => entry.messageId === messageId);
  }

  connect(steerTargets: SteerTargetStore): DaemonConnection {
    const channel = {
      serverInfo: { features: { hostInputQueue: true } },
      permissions: [],
      write: async (frame: string) => {
        const envelope: unknown = JSON.parse(frame);
        if (isRecord(envelope) && isRecord(envelope["message"])) this.receive(envelope["message"]);
      },
    };
    return connectEnrolledChannelDaemon({
      hostLabel: "strict-host",
      hostId: "strict-host",
      resolveChannel: () => (this.away ? undefined : channel),
      subscribe: (handler) => {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
      },
      onHostDisconnected: (handler) => {
        this.disconnects.add(handler);
        return () => this.disconnects.delete(handler);
      },
      steerTargets,
    });
  }

  private answer(type: string, requestId: unknown, payload: Record<string, unknown>) {
    queueMicrotask(() => {
      for (const handler of this.handlers) handler({ type, payload: { ...payload, requestId } });
    });
  }

  /** Why a strict Steer naming `expected` is refused before delivery, if it is. */
  private strictRefusal(expected: string | null): string | undefined {
    if (expected === null)
      return this.turn === null
        ? undefined
        : "Active turn identity is unavailable; wait or choose Queue";
    return expected === this.turn
      ? undefined
      : "Active turn changed before steering could be delivered";
  }

  private receive(message: Record<string, unknown>) {
    const requestId = message["requestId"];
    if (message["type"] === "fetch_agent_request") {
      const agent = {
        id: message["agentId"],
        status: this.turn === null ? "idle" : "running",
        activeTurn: this.turn === null ? null : { turnId: this.turn },
      };
      this.answer("fetch_agent_response", requestId, { agent, project: null, error: null });
      return;
    }
    if (message["type"] !== "send_agent_message_request") return;
    this.beforeSend?.();
    this.beforeSend = undefined;
    const reply = (error?: string) =>
      this.answer("send_agent_message_response", requestId, {
        agentId: message["agentId"],
        accepted: error === undefined,
        ...(error === undefined ? {} : { error }),
      });
    const messageId = String(message["messageId"]);
    this.attempts.push(messageId);
    const expected =
      typeof message["expectedTurnId"] === "string" ? message["expectedTurnId"] : null;
    const key = `${String(message["agentId"])}/${messageId}`;
    const fingerprint = JSON.stringify([message["text"], message["activeTurnBehavior"], expected]);
    const held = this.receipts.get(key);
    if (held !== undefined) {
      if (held.fingerprint !== fingerprint) return reply("agent_request_key_conflict");
      return reply(held.completed ? undefined : "agent_request_outcome_unknown");
    }
    this.receipts.set(key, { fingerprint, completed: false });
    const refusal = this.strictRefusal(expected);
    if (refusal !== undefined) {
      if (!this.beforeV222) this.receipts.delete(key);
      return reply(refusal);
    }
    this.delivered.push({ messageId, turn: expected });
    if (expected === null) this.startTurn();
    this.receipts.set(key, { fingerprint, completed: true });
    if (this.loseNextAnswer) {
      this.loseNextAnswer = false;
      this.dropConnections();
      return;
    }
    if (this.holdNextAnswer) {
      this.holdNextAnswer = false;
      return;
    }
    reply();
  }
}

describe("a follow-up Steer on a Host with the input queue", () => {
  /** A Hub process: its own plane and daemon connection over the shared database. */
  async function hubProcess(host: StrictHost, steerTargets: SteerTargetStore) {
    const daemon = makeDaemon();
    const connection = host.connect(steerTargets);
    daemon.daemon.sendAgentMessage = (agentId, text, options) =>
      connection.sendAgentMessage(agentId, text, options);
    const flow = makePlane(makeRoute({ followUp: { mode: "auto", ttlMinutes: 60 } }), daemon);
    await flow.plane.start(daemon.daemon, store);
    /** The drain handing an admitted row to this process again. */
    const redeliver = (message: InboundMessage, recordId: string) =>
      flow.plane.onInbound(
        claimedInbound(
          { channel: "slack", accountId: ACCOUNT_ID, ctxPayload: { Message: message } },
          recordId,
        ),
      );
    const stop = async () => {
      await flow.plane.stop();
      connection.stop();
    };
    return { ...flow, redeliver, stop };
  }

  const durable = (): SteerTargetStore => store.steerTargets.forOrganization(ORGANIZATION_ID);
  /** The durable store, with the Host leaving right after an attempt counted itself. */
  const hostLeavesAfterCount = (host: StrictHost): SteerTargetStore => {
    const targets = durable();
    return {
      ...targets,
      begin: async (agentId, messageId) => {
        const turn = await targets.begin(agentId, messageId);
        host.away = true;
        return turn;
      },
    };
  };
  const messageIdOf = (message: InboundMessage) => channelMessageId(message);

  /** The same durable row the drain claims again after a failed or unacknowledged attempt. */
  async function rowOfMessage(message: InboundMessage) {
    const { record, created } = await store.enqueueChannelIngress({
      organizationId: ORGANIZATION_ID,
      channel: "slack",
      accountId: ACCOUNT_ID,
      externalEventId: message.externalMessageId!,
      externalMessageId: message.externalMessageId!,
      externalConversationId: message.conversation.rootConversationId,
      externalThreadId: message.conversation.threadId,
      laneKey: `lane:${String(message.conversation.threadId)}`,
      payload: { channel: "slack", accountId: ACCOUNT_ID, ctxPayload: { Message: message } },
    });
    assert.equal(created, false, "the retry is the row the first attempt was admitted as");
    return record;
  }

  it("answers a follow-up the Host took before a Hub restart as delivered, though the turn changed", async () => {
    const say = conversation();
    const host = new StrictHost();
    const before = await hubProcess(host, durable());
    await before.send(say("start the build"));
    const firstTurn = host.turn;
    assert.ok(firstTurn !== null, "the first prompt started a turn");
    const followUp = say("also check the logs");
    // The Host takes the Steer; its answer is lost and the Hub process ends unacknowledged.
    host.loseNextAnswer = true;
    assert.ok((await before.send(followUp).catch((error: unknown) => error)) instanceof Error);
    await before.stop();
    host.startTurn();

    const after = await hubProcess(host, durable());
    try {
      await after.redeliver(followUp, (await rowOfMessage(followUp)).id);
      const id = messageIdOf(followUp);
      assert.equal(host.attempts.filter((attempt) => attempt === id).length, 2);
      assert.deepEqual(host.deliveriesOf(id), [{ messageId: id, turn: firstTurn }]);

      // Control: a Hub that lost the record names the new turn, and the Host refuses it for good.
      const forgetful = host.connect(createMemorySteerTargets());
      await assert.rejects(
        forgetful.sendAgentMessage("agent-0", "also check the logs", {
          source: followUp,
          messageId: id,
        }),
        AgentRequestRefusedError,
      );
      forgetful.stop();
    } finally {
      await after.stop();
    }
  });

  it("names the turn the first replica recorded when another replica retries a lost answer", async () => {
    const say = conversation();
    const host = new StrictHost();
    const first = await hubProcess(host, durable());
    const second = await hubProcess(host, durable());
    try {
      await first.send(say("start the build"));
      const runningTurn = host.turn;
      const followUp = say("and the tests");
      host.loseNextAnswer = true;
      const attempt = await first.send(followUp).catch((error: unknown) => error);
      assert.ok(attempt instanceof Error, "the answer was lost, so the outcome is unknown");
      host.startTurn();
      const record = await rowOfMessage(followUp);
      await second.redeliver(followUp, record.id);
      assert.deepEqual(host.deliveriesOf(messageIdOf(followUp)), [
        { messageId: messageIdOf(followUp), turn: runningTurn },
      ]);
    } finally {
      await first.stop();
      await second.stop();
    }
  });

  it("keeps the turn an unknown attempt named when a later attempt never reaches the Host", async () => {
    const say = conversation();
    const host = new StrictHost();
    const flow = await hubProcess(host, durable());
    try {
      await flow.send(say("start the build"));
      const firstTurn = host.turn;
      const followUp = say("also check the logs");
      // Attempt 1: the Host takes it, the answer is lost.
      host.loseNextAnswer = true;
      assert.ok((await flow.send(followUp).catch((error: unknown) => error)) instanceof Error);
      const record = await rowOfMessage(followUp);
      // Attempt 2 counts itself, then the Host is gone: refused before anything is written.
      const leaving = await hubProcess(host, hostLeavesAfterCount(host));
      await assert.rejects(leaving.redeliver(followUp, record.id), HostNotReachedError);
      await leaving.stop();
      host.away = false;
      host.startTurn();
      // Attempt 3 names the turn attempt 1 may have been delivered into.
      await flow.redeliver(followUp, record.id);
      const id = messageIdOf(followUp);
      assert.equal(host.attempts.filter((sent) => sent === id).length, 2);
      assert.deepEqual(host.deliveriesOf(id), [{ messageId: id, turn: firstTurn }]);
    } finally {
      await flow.stop();
    }
  });

  it("keeps the turn while one replica's attempt is in flight and another's never reaches the Host", async () => {
    const say = conversation();
    const host = new StrictHost();
    const first = await hubProcess(host, durable());
    const second = await hubProcess(host, hostLeavesAfterCount(host));
    const third = await hubProcess(host, durable());
    try {
      await first.send(say("start the build"));
      const firstTurn = host.turn;
      const followUp = say("and the tests");
      const id = messageIdOf(followUp);
      host.holdNextAnswer = true;
      const inFlight = first.send(followUp).catch((error: unknown) => error);
      await waitFor(() => host.attempts.includes(id));
      const record = await rowOfMessage(followUp);
      await assert.rejects(second.redeliver(followUp, record.id), HostNotReachedError);
      host.away = false;
      host.dropConnections();
      assert.ok((await inFlight) instanceof Error, "the in-flight outcome is unknown");
      host.startTurn();
      await third.redeliver(followUp, record.id);
      assert.deepEqual(host.deliveriesOf(id), [{ messageId: id, turn: firstTurn }]);
    } finally {
      await first.stop();
      await second.stop();
      await third.stop();
    }
  });

  it("recovers a Steer whose turn ended before it arrived, from Host 2.2.2", async () => {
    const say = conversation();
    const host = new StrictHost();
    const flow = await hubProcess(host, durable());
    try {
      await flow.send(say("start the build"));
      const followUp = say("one more thing");
      host.beforeSend = () => {
        host.turn = null;
      };
      const refused = await flow.send(followUp).catch((error: unknown) => error);
      assert.match(String(refused), /Active turn changed/);
      const record = await rowOfMessage(followUp);
      await flow.redeliver(followUp, record.id);
      assert.deepEqual(host.deliveriesOf(messageIdOf(followUp)), [
        { messageId: messageIdOf(followUp), turn: null },
      ]);
    } finally {
      await flow.stop();
    }
  });

  it("dead-letters, never duplicates, a Steer whose turn ended before it arrived on an older Host", async () => {
    const say = conversation();
    const host = new StrictHost();
    host.beforeV222 = true;
    const flow = await hubProcess(host, durable());
    try {
      await flow.send(say("start the build"));
      const followUp = say("one more thing");
      host.beforeSend = () => {
        host.turn = null;
      };
      await flow.send(followUp).catch(() => undefined);
      const record = await rowOfMessage(followUp);
      // The refused attempt keeps its receipt there: the retry is refused for good, so the
      // drain dead-letters it at once and tells the sender. No Hub-side order avoids this.
      await assert.rejects(flow.redeliver(followUp, record.id), AgentRequestRefusedError);
      assert.deepEqual(host.deliveriesOf(messageIdOf(followUp)), []);
    } finally {
      await flow.stop();
    }
  });
});
