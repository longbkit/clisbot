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
import type { DaemonConnection } from "../daemon/client.js";
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
    discovery: { url: "ws://127.0.0.1:6767/ws", source: "default-port" },
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
  options: { envFlag?: boolean } = {},
) {
  const flushes: { admission: HeldFlushAdmission; id: string }[] = [];
  const posted: string[] = [];
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
    clock: new ManualClock(1_000),
    logger: SILENT,
    post: async (post) => {
      posted.push(post.text);
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
  return { plane, send, flush, flushes, posted, sends: daemon.sends };
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
