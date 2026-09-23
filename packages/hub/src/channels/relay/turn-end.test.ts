// How a turn's end reaches the user on each Reply method
// (docs/audits/2026-09-22-channel-reply-hybrid-mode.md): a failed turn is
// reported, a `tool` turn that answered nothing falls back to its last
// message, and a `hybrid` turn never relays text the tool already posted.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { ChannelStore } from "../../db/channels.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import { ChannelReplyCapabilityRegistry } from "../channel-reply-capabilities.js";
import type {
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import type { OutboundPath } from "../config/enums.js";
import { ManualClock } from "../plane/clock.js";
import type { StreamContext } from "../plane/types.js";
import { RelayEngine } from "./index.js";
import { actionDelivery } from "../channel-reply-turn-record.js";
import { NO_REPLY_NOTICE } from "./turn-end.js";

const ORGANIZATION_ID = "turn-end-org";
const AGENT_ID = "agent-turn-end";

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;
let conversationSeq = 0;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-relay-turn-end-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ($1, 'Turn End Org', 'turn-end-org')`,
    [ORGANIZATION_ID],
  );
  store = new ChannelStore(bundle.runtime);
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

/** The route's sync knobs as `foldDefaults` leaves them for `path`. */
function defaults(path: OutboundPath): EffectiveDefaults {
  const relaysText = path !== "tool";
  return {
    requireMention: true,
    followUp: { mode: "auto", ttlMinutes: 60 },
    bindingKey: "thread",
    replyAnchor: "thread",
    outbound: { path, template: null },
    inbound: { reactionNotifications: "off", editNotifications: "off" },
    sync: {
      finalAnswers: relaysText,
      progress: { progressMessage: false, typingIndicator: false, messageReaction: "off" },
      toolCalls: false,
      threadLink: "none",
      subagents: { finalAnswers: false, progress: false, toolCalls: false },
    },
  };
}

function context(path: OutboundPath): StreamContext {
  conversationSeq += 1;
  const conversation = `C0TURNEND${conversationSeq}`;
  const route: CompiledRoute = {
    audienceRules: [],
    where: { dm: false, groups: [], conversations: [conversation] },
    target: { kind: "agent", agent: "worker", environment: "repo", template: null },
    defaultRoles: [],
    assignments: [],
    defaults: defaults(path),
    approval: [],
  };
  const account: CompiledChannelAccount = {
    channel: "slack",
    accountId: "work",
    enabled: true,
    channelEnabled: true,
    connectionId: "connection-id",
    transport: {},
    config: {},
    defaultRoles: [],
    assignments: [],
    defaults: route.defaults,
    approval: [],
    routes: [route],
  };
  return {
    agentId: AGENT_ID,
    channel: "slack",
    accountId: "work",
    externalConversationId: conversation,
    externalThreadId: "1.0",
    initiator: "slack:U0ALICE",
    account,
    route,
    rootKind: "channel",
  };
}

let capabilities: ChannelReplyCapabilityRegistry;
let token: string;
let posted: string[];
let engine: RelayEngine;

let leaseSeq = 0;

/** A channel message reaches the session: the next turn's end is owed to it. */
function channelMessage(): void {
  leaseSeq += 1;
  capabilities.noteTurn(AGENT_ID, `lease-${leaseSeq}`);
}

/** Attach the relay; by default the coming turn is a channel turn. */
function start(path: OutboundPath, from: "channel" | "app" = "channel"): void {
  engine.attach(context(path));
  if (from === "channel") channelMessage();
}

async function fail(turnId: string, error = "boom"): Promise<void> {
  await engine.onStream(AGENT_ID, { kind: "turn_closed", turnId, reason: "failed", error });
}

async function complete(turnId: string): Promise<void> {
  await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId });
}

async function say(turnId: string, messageId: string, text: string): Promise<void> {
  await engine.onStream(AGENT_ID, {
    kind: "timeline",
    turnId,
    item: { type: "assistant_message", messageId, text },
  });
}

beforeEach(() => {
  capabilities = new ChannelReplyCapabilityRegistry();
  token = capabilities.issue({
    organizationId: ORGANIZATION_ID,
    channelRevisionId: null,
    routePosition: 0,
    routeFingerprint: "fp",
    ref: {
      channel: "slack",
      accountId: "work",
      externalConversationId: "C0TURNEND",
      externalThreadId: "1.0",
    },
  });
  capabilities.bind(token, AGENT_ID);
  posted = [];
  engine = new RelayEngine({
    organizationId: ORGANIZATION_ID,
    logger: { warn: () => undefined, info: () => undefined },
    clock: new ManualClock(),
    store,
    post: async (params) => {
      posted.push(params.text);
      return { ok: true, externalMessageId: `m${posted.length}` };
    },
    toolDeliveries: capabilities,
  });
});

describe("a failed turn", () => {
  it("on Text forward posts the partial answer, then one notice, never the server's copy", async () => {
    start("relay");
    await say("t1", "m1", "Half an answer");
    // The daemon's own `[System Error]` copy arrives with no turn id.
    await say("", "err", "[System Error] model overloaded");
    await fail("t1", "model overloaded");
    assert.deepEqual(posted, [
      "Half an answer",
      "⚠️ The agent stopped with an error: model overloaded",
    ]);
  });

  it("is reported once when its end is replayed", async () => {
    start("relay");
    await fail("t1");
    await fail("t1");
    assert.deepEqual(posted, ["⚠️ The agent stopped with an error: boom"]);
  });

  it("on Channel tool is reported when the tool had not answered", async () => {
    start("tool");
    capabilities.noteDelivery(token, { kind: "send", final: false, text: "Working on it" });
    await fail("t1");
    assert.deepEqual(posted, ["⚠️ The agent stopped with an error: boom"]);
  });

  it("on Channel tool stays quiet when the tool already answered", async () => {
    start("tool");
    capabilities.noteDelivery(token, { kind: "send", final: true, text: "Done" });
    await fail("t1");
    assert.deepEqual(posted, []);
  });

  it("on Channel tool stays quiet for a turn the channel did not start", async () => {
    start("tool", "app");
    await fail("t1");
    assert.deepEqual(posted, []);
  });

  it("on hybrid does not flush text the tool already posted", async () => {
    start("hybrid");
    capabilities.noteDelivery(token, { kind: "send", final: true, text: "Report attached" });
    await say("t1", "m1", "Report attached");
    await fail("t1");
    assert.deepEqual(posted, ["⚠️ The agent stopped with an error: boom"]);
  });

  it("is silent when it was canceled on purpose", async () => {
    start("relay");
    await say("t1", "m1", "Half an answer");
    await engine.onStream(AGENT_ID, { kind: "turn_closed", turnId: "t1", reason: "canceled" });
    assert.deepEqual(posted, []);
  });
});

describe("a completed Channel tool turn", () => {
  it("posts nothing more when the tool answered", async () => {
    start("tool");
    capabilities.noteDelivery(token, { kind: "send", final: true, text: "The answer" });
    await say("t1", "m1", "Sent.");
    await complete("t1");
    assert.deepEqual(posted, []);
  });

  it("posts nothing more when a reaction was the whole answer", async () => {
    start("tool");
    capabilities.noteDelivery(token, { kind: "action" });
    await say("t1", "m1", "Reacted.");
    await complete("t1");
    assert.deepEqual(posted, []);
  });

  it("forwards the last message when only progress went out", async () => {
    start("tool");
    capabilities.noteDelivery(token, { kind: "send", final: false, text: "Looking…" });
    await say("t1", "m1", "The result is 42.");
    await complete("t1");
    assert.deepEqual(posted, ["The result is 42."]);
  });

  it("forwards the last message when the tool was never called", async () => {
    start("tool");
    await say("t1", "m1", "Thinking out loud");
    await say("t1", "m2", "Final answer");
    await complete("t1");
    assert.deepEqual(posted, ["Final answer"]);
  });

  it("posts a notice when there is nothing to forward", async () => {
    start("tool");
    await complete("t1");
    assert.deepEqual(posted, [NO_REPLY_NOTICE]);
  });

  it("posts nothing for a turn started from the Paseo app", async () => {
    start("tool", "app");
    await say("t1", "m1", "An answer for the app user");
    await complete("t1");
    assert.deepEqual(posted, []);
  });

  it("answers once when its end is replayed", async () => {
    start("tool");
    capabilities.noteDelivery(token, { kind: "send", final: true, text: "The answer" });
    await complete("t1");
    await complete("t1");
    assert.deepEqual(posted, []);
  });

  it("starts the next turn with a clean record", async () => {
    start("tool");
    capabilities.noteDelivery(token, { kind: "send", final: true, text: "One" });
    await complete("t1");
    channelMessage();
    await say("t2", "m2", "Two, untold");
    await complete("t2");
    assert.deepEqual(posted, ["Two, untold"]);
  });

  it("owes the conversation the turn a message started by replacing the running one", async () => {
    start("tool", "app");
    await say("t1", "m1", "Started in the app");
    // A channel message on a provider without native steering cancels the
    // running turn and starts a new one.
    channelMessage();
    await engine.onStream(AGENT_ID, { kind: "turn_closed", turnId: "t1", reason: "canceled" });
    await say("t2", "m2", "Answer to the channel message");
    await complete("t2");
    assert.deepEqual(posted, ["Answer to the channel message"]);
  });

  it("owes the conversation a turn the message steered into", async () => {
    start("tool", "app");
    await say("t1", "m1", "Started in the app");
    // A channel message steers into the running app turn.
    channelMessage();
    await say("t1", "m2", "Answer covering both");
    await complete("t1");
    assert.deepEqual(posted, ["Answer covering both"]);
  });
});

describe("a completed hybrid turn", () => {
  it("relays the final answer as text", async () => {
    start("hybrid");
    capabilities.noteDelivery(token, { kind: "send", final: true });
    await say("t1", "m1", "Here is the chart.");
    await complete("t1");
    assert.deepEqual(posted, ["Here is the chart."]);
  });

  it("does not relay text the tool already posted", async () => {
    start("hybrid");
    capabilities.noteDelivery(token, { kind: "send", final: true, text: "Here  is\nthe answer" });
    await say("t1", "m1", "Here is the answer");
    await complete("t1");
    assert.deepEqual(posted, []);
  });
});

describe("progress pacing", () => {
  it("allows one landed progress send per 30 seconds", () => {
    let now = 1_000;
    const paced = new ChannelReplyCapabilityRegistry({ now: () => now });
    const pacedToken = paced.issue({
      organizationId: ORGANIZATION_ID,
      channelRevisionId: null,
      routePosition: 0,
      routeFingerprint: "fp",
      ref: {
        channel: "slack",
        accountId: "work",
        externalConversationId: "C0",
        externalThreadId: null,
      },
    });
    // Admission alone does not start the window: a send that failed posted nothing.
    assert.equal(paced.admitProgress(pacedToken), true);
    assert.equal(paced.admitProgress(pacedToken), true);
    paced.noteDelivery(pacedToken, { kind: "send", final: false, text: "Step 1" });
    now += 10_000;
    assert.equal(paced.admitProgress(pacedToken), false);
    now += 20_000;
    assert.equal(paced.admitProgress(pacedToken), true);
  });
});

describe("actionDelivery", () => {
  it("counts new content as an answer, a visible change as an act, and a read as nothing", () => {
    assert.deepEqual(actionDelivery("upload-file"), { kind: "send", final: true });
    assert.deepEqual(actionDelivery("react"), { kind: "action" });
    assert.equal(actionDelivery("search"), undefined);
    assert.equal(actionDelivery("download-file"), undefined);
    assert.equal(actionDelivery("not-an-action"), undefined);
  });
});
