// Targeted tests for the Hub-side streaming producer (goal ledger slice 22b),
// driven through the PRODUCTION path: a real `RelayEngine` over a real
// `ChannelStore` (embedded PGlite), with the streaming driver built by
// `createStreamingDriver` from a vertical's `plugin.outbound`. The fakes carry
// upstream's primitive names and shapes, so a vertical that publishes them is
// drivable without a Hub change; the Telegram block-mode cases at the bottom
// drive the SHIPPED dist instead, because D-W4-03 only reproduces against a
// drive path whose calls take more than a microtask to resolve.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ChannelStore } from "../../db/channels.js";
import { embeddedDatabaseRuntime, type DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import type {
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import type { SyncStreaming } from "../config/schema.js";
import { ManualClock } from "../plane/clock.js";
import type {
  OutboundPostParams,
  OutboundPostResult,
  SupportedChannelName,
  PlaneLogger,
  StreamContext,
} from "../plane/types.js";
import { DEFAULT_PROGRESS_THROTTLE_MS, RelayEngine } from "../relay/index.js";
import { ChannelStreamingProducer, createStreamingDriver } from "./index.js";
// The BUILT vertical, not its source: the streaming drive path has to hold
// against what the Hub actually loads at runtime.
import {
  sendText as telegramSendText,
  updateText as telegramUpdateText,
} from "@getpaseo/channels-telegram/dist/outbound.js";

const ORGANIZATION_ID = "streaming-org";
const AGENT_ID = "agent-stream";
const THREAD = "1720000000.000000";
const SILENT: PlaneLogger = { warn: () => undefined, info: () => undefined };

/** A call log entry: the primitive name plus the payload the Hub passed. */
interface Call {
  name: string;
  args: Record<string, unknown>;
}

function defaults(streaming: SyncStreaming | undefined): EffectiveDefaults {
  return {
    requireMention: true,
    followUp: { mode: "auto", ttlMinutes: 60 },
    bindingKey: "thread",
    replyAnchor: "thread",
    outbound: { path: "relay", template: null },
    inbound: { reactionNotifications: "off", editNotifications: "off" },
    sync: {
      finalAnswers: true,
      progress: { progressMessage: true, typingIndicator: false, messageReaction: "off" },
      toolCalls: false,
      threadLink: "none",
      ...(streaming === undefined ? {} : { streaming }),
      subagents: { finalAnswers: false, progress: false, toolCalls: false },
    },
  };
}

function context(params: {
  channel?: SupportedChannelName;
  conversation: string;
  /** The reply anchor; Telegram's is a numeric forum topic id. */
  threadId?: string;
  streaming: SyncStreaming | undefined;
}): StreamContext {
  const route: CompiledRoute = {
    match: { kind: "channel", ids: [params.conversation] },
    target: { kind: "agent", agent: "worker", environment: "repo", template: null },
    defaultRoles: [],
    assignments: [],
    defaults: defaults(params.streaming),
    approval: [],
  };
  const account: CompiledChannelAccount = {
    channel: params.channel ?? "slack",
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
    fallback: { deny: true },
  };
  return {
    agentId: AGENT_ID,
    channel: params.channel ?? "slack",
    accountId: "work",
    externalConversationId: params.conversation,
    externalThreadId: params.threadId ?? THREAD,
    initiator: "slack:U0ALICE",
    account,
    route,
    rootKind: "channel",
  };
}

// --- Fake verticals ---------------------------------------------------------

/** Upstream's own streaming mode/native resolvers, as the Slack vertical
 * publishes them. Kept faithful to `streaming-compat.ts`: an authored block
 * with no `mode` resolves to `progress`, and `nativeTransport` defaults on. */
const slackResolvers = {
  resolveSlackStreamingMode: (params: { streaming?: SyncStreaming }) =>
    params.streaming?.mode ?? "progress",
  resolveSlackNativeStreaming: (params: { streaming?: SyncStreaming }) =>
    params.streaming?.nativeTransport ?? true,
};

/** A Slack-shaped outbound: the three native stream primitives, the in-place
 * edit both verticals publish, and upstream's progress card builder. */
function slackOutbound(
  calls: Call[],
  options: { appendThrows?: boolean } = {},
): Record<string, unknown> {
  return {
    ...slackResolvers,
    startSlackStream: async (args: Record<string, unknown>) => {
      calls.push({ name: "start", args });
      return { id: "session-1" };
    },
    appendSlackStream: async (args: Record<string, unknown>) => {
      calls.push({ name: "append", args });
      if (options.appendThrows === true) throw new Error("append rejected");
    },
    stopSlackStream: async (args: Record<string, unknown>) => {
      calls.push({ name: "stop", args });
      return { messageId: "1720000000.000900" };
    },
    updateText: async (args: Record<string, unknown>) => {
      calls.push({ name: "updateText", args });
      return { ok: true };
    },
    buildSlackProgressCardBlocks: (args: Record<string, unknown>) => {
      calls.push({ name: "progressBlocks", args });
      return [{ type: "section", text: { type: "mrkdwn", text: String(args["title"]) } }];
    },
  };
}

/** A Telegram-shaped outbound: `updateText` only (no native transport, no
 * Block Kit) — the edit-in-place draft is all it can drive. */
function telegramOutbound(calls: Call[]): Record<string, unknown> {
  return {
    updateText: async (args: Record<string, unknown>) => {
      calls.push({ name: "updateText", args });
      return { ok: true };
    },
  };
}

// --- Harness ----------------------------------------------------------------

interface Harness {
  engine: RelayEngine;
  clock: ManualClock;
  posts: OutboundPostParams[];
}

function harness(params: {
  outbound: Record<string, unknown> | undefined;
  channel?: SupportedChannelName;
  post?: (p: OutboundPostParams) => Promise<OutboundPostResult>;
  /** The drive-time token context and host, for a real vertical's dist. */
  cfg?: Record<string, unknown>;
  hostRuntime?: unknown;
  logger?: PlaneLogger;
}): Harness {
  const clock = new ManualClock(1_000);
  const posts: OutboundPostParams[] = [];
  let counter = 0;
  const post = async (p: OutboundPostParams): Promise<OutboundPostResult> => {
    posts.push(p);
    if (params.post !== undefined) return await params.post(p);
    counter += 1;
    return { ok: true, externalMessageId: `1720000000.00000${counter}` };
  };
  const driver = createStreamingDriver({
    channel: params.channel ?? "slack",
    accountId: "work",
    cfg: params.cfg ?? {},
    hostRuntime: (params.hostRuntime ?? {}) as never,
    outbound: params.outbound,
    logger: SILENT,
  });
  const engine = new RelayEngine({
    organizationId: ORGANIZATION_ID,
    logger: SILENT,
    clock,
    store,
    post,
    progressThrottleMs: DEFAULT_PROGRESS_THROTTLE_MS,
    ...(driver === undefined
      ? {}
      : {
          streaming: new ChannelStreamingProducer({
            logger: params.logger ?? SILENT,
            clock,
            driver,
            post,
          }),
        }),
  });
  return { engine, clock, posts };
}

async function delta(engine: RelayEngine, turnId: string, text: string): Promise<void> {
  await engine.onStream(AGENT_ID, {
    kind: "timeline",
    turnId,
    item: { type: "assistant_message", messageId: "m1", text },
  });
}

async function ledgerRows(
  conversation: string,
): Promise<{ status: string; externalMessageId: string | null }[]> {
  const result = await bundle.runtime.query<{
    status: string;
    external_message_id: string | null;
  }>(
    `select status, external_message_id from delivery_ledger
     where organization_id = $1 and external_conversation_id = $2 and direction = 'out'
     order by sequence`,
    [ORGANIZATION_ID, conversation],
  );
  return result.rows.map((row) => ({
    status: row.status,
    externalMessageId: row.external_message_id,
  }));
}

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-streaming-db-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ($1, 'Streaming Org', 'streaming-org')`,
    [ORGANIZATION_ID],
  );
  store = new ChannelStore(bundle.runtime);
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("slack native streaming", () => {
  it("starts, appends and stops one native stream for a turn", async () => {
    const calls: Call[] = [];
    const { engine, clock, posts } = harness({ outbound: slackOutbound(calls) });
    engine.attach(
      context({ conversation: "C0NATIVE", streaming: { mode: "partial", nativeTransport: true } }),
    );

    await delta(engine, "turn-native", "Hello");
    clock.advance(1_000);
    await delta(engine, "turn-native", " world");
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-native" });

    assert.deepEqual(
      calls.map((call) => call.name),
      ["start", "append", "stop"],
    );
    assert.equal(calls[0]?.args["channel"], "C0NATIVE");
    assert.equal(calls[0]?.args["threadTs"], THREAD);
    assert.equal(calls[0]?.args["text"], "Hello");
    // Only the tail is appended: the native stream already holds the prefix.
    assert.equal(calls[1]?.args["text"], " world");
    // The stop appends nothing new — the draft already shows the final answer.
    assert.equal(calls[2]?.args["text"], undefined);
    assert.deepEqual(posts, [], "a native stream never posts a message");
    assert.deepEqual(await ledgerRows("C0NATIVE"), [
      { status: "posted", externalMessageId: "1720000000.000900" },
    ]);
  });

  // An answer past the channel's draft cap ends on the plain post path. The
  // native draft is an OPEN stream, so finishing without stopping it left the
  // stream running beside the posted answer.
  it("stops the native stream when the answer outgrows the draft cap", async () => {
    const calls: Call[] = [];
    const { engine, clock, posts } = harness({ outbound: slackOutbound(calls) });
    engine.attach(
      context({
        conversation: "C0NATIVEBIG",
        streaming: { mode: "partial", nativeTransport: true },
      }),
    );

    await delta(engine, "turn-native-big", "Head.\n");
    clock.advance(1_000);
    // Past Slack's 8000-char draft cap: the draft stops taking pushes.
    await delta(engine, "turn-native-big", "x".repeat(9_000));
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-native-big" });

    assert.deepEqual(
      calls.map((call) => call.name),
      ["start", "append", "stop"],
      "the open native stream is closed, not abandoned",
    );
    // The stream carries the answer's first message (`stop` appends the tail of
    // the head, then finalizes), and only the remainder is posted after it.
    const appended = calls[1]?.args["text"];
    assert.ok(typeof appended === "string");
    assert.equal(appended.length, 8_000 - "Head.\n".length);
    assert.deepEqual(
      posts.map((post) => post.text.length),
      [9_006 - 8_000],
    );
  });

  it("delivers the reply once on one row when the native append throws", async () => {
    const calls: Call[] = [];
    const { engine, clock, posts } = harness({
      outbound: slackOutbound(calls, { appendThrows: true }),
    });
    engine.attach(
      context({ conversation: "C0BROKEN", streaming: { mode: "partial", nativeTransport: true } }),
    );

    await delta(engine, "turn-broken", "Hello");
    clock.advance(1_000);
    await delta(engine, "turn-broken", " world");
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-broken" });

    assert.deepEqual(
      calls.map((call) => call.name),
      ["start", "append"],
      "the broken draft is not finalized",
    );
    assert.deepEqual(
      posts.map((post) => post.text),
      ["Hello world"],
      "the full reply still lands, exactly once",
    );
    assert.deepEqual(await ledgerRows("C0BROKEN"), [
      { status: "posted", externalMessageId: "1720000000.000001" },
    ]);
  });
});

describe("edit-in-place drafts", () => {
  it("posts one draft and edits it to the final answer in block mode", async () => {
    const calls: Call[] = [];
    const { engine, clock, posts } = harness({ outbound: slackOutbound(calls) });
    engine.attach(context({ conversation: "C0EDIT", streaming: { mode: "block" } }));

    await delta(engine, "turn-edit", "Hel");
    clock.advance(1_000);
    await delta(engine, "turn-edit", "lo");
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-edit" });

    // `block` never uses the native transport, even where it exists.
    assert.deepEqual(
      calls.map((call) => call.name),
      ["updateText", "updateText"],
    );
    assert.equal(calls[0]?.args["text"], "Hello");
    assert.equal(calls[1]?.args["text"], "Hello");
    assert.equal(calls[0]?.args["clearCard"], false);
    assert.deepEqual(
      posts.map((post) => post.text),
      ["Hel"],
      "only the draft's first message is posted",
    );
    assert.deepEqual(await ledgerRows("C0EDIT"), [
      { status: "posted", externalMessageId: "1720000000.000001" },
    ]);
  });

  it("paces telegram edits by the channel's minimum interval", async () => {
    const calls: Call[] = [];
    const { engine, clock, posts } = harness({
      channel: "telegram",
      outbound: telegramOutbound(calls),
    });
    engine.attach(
      context({ channel: "telegram", conversation: "-100777", streaming: { mode: "partial" } }),
    );

    await delta(engine, "turn-tg", "a");
    // Inside the window: held, not edited.
    clock.advance(400);
    await delta(engine, "turn-tg", "b");
    assert.equal(calls.length, 0, "an edit inside the pacing window is held");
    clock.advance(600);
    await delta(engine, "turn-tg", "c");
    assert.deepEqual(
      calls.map((call) => call.args["text"]),
      ["abc"],
      "the next edit past the window carries everything accumulated since",
    );
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-tg" });

    assert.deepEqual(
      calls.map((call) => call.args["text"]),
      ["abc", "abc"],
    );
    assert.deepEqual(
      posts.map((post) => post.text),
      ["a"],
    );
    assert.deepEqual(await ledgerRows("-100777"), [
      { status: "posted", externalMessageId: "1720000000.000001" },
    ]);
  });

  it("reports a refused edit once per account, not once per delta", async () => {
    const warnings: string[] = [];
    const { engine, clock, posts } = harness({
      channel: "telegram",
      logger: { warn: (message) => void warnings.push(message), info: () => undefined },
      outbound: {
        updateText: async () => {
          throw new Error("chat not found");
        },
      },
    });
    engine.attach(
      context({ channel: "telegram", conversation: "-100888", streaming: { mode: "block" } }),
    );

    for (const text of ["a", "b", "c", "d"]) {
      clock.advance(1_000);
      await delta(engine, "turn-loud", text);
    }
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-loud" });

    assert.deepEqual(warnings, ["channel streaming draft failed"]);
    assert.deepEqual(
      posts.map((post) => post.text),
      ["a", "abcd"],
      "the draft's first message, then the full answer through the plain path",
    );
  });
});

// --- The real Telegram vertical (D-W4-03) -----------------------------------
//
// Live wave 4 scenario 7: a `block`-mode topic route posted a draft stub (`##`)
// and never edited it — zero `editMessageText` calls in `hub.log` — then posted
// the answer as seven fresh messages beside it. The fake outbound above could
// not see it, because it resolves in the same microtask the delta arrives in.
// These cases drive the SHIPPED Telegram dist against a fake Bot API, with the
// draft's first post held open while the next delta lands, which is what the
// Hub's fire-and-forget stream dispatch does on every live turn.

/** The account's cfg in upstream's shape: the token the ported send path reads. */
const TELEGRAM_CFG = {
  channels: { telegram: { accounts: { work: { botToken: "123456:tg-streaming-test-token" } } } },
} as unknown as Record<string, unknown>;
const TELEGRAM_CHAT = "-1004439007919";
const TELEGRAM_TOPIC = "2";

interface ApiCall {
  method: string;
  args: unknown[];
}

/** The vertical's own `api` test seam (`send-message-types.ts`), recording every
 * Bot API method the ported send path reaches for. `hold` keeps a send open so
 * the next delta arrives while the draft's first post is still on the wire. */
function fakeBotApi(calls: ApiCall[], hold?: () => Promise<void>): Record<string, unknown> {
  let sends = 0;
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      if (method === "sendMessage" && hold !== undefined) await hold();
      sends += 1;
      // Upstream's provider-thread proof re-reads the topic off the returned
      // message, so the fake echoes what it was asked to post into.
      const params = (args.at(-1) ?? {}) as { message_thread_id?: number };
      return {
        message_id: sends,
        chat: { id: Number(TELEGRAM_CHAT), type: "supergroup", is_forum: true },
        ...(typeof params.message_thread_id === "number"
          ? { message_thread_id: params.message_thread_id, is_topic_message: true }
          : {}),
      };
    };
  return {
    sendMessage: record("sendMessage"),
    editMessageText: record("editMessageText"),
    editMessageCaption: record("editMessageCaption"),
    editMessageReplyMarkup: record("editMessageReplyMarkup"),
    getChat: async () => ({ id: Number(TELEGRAM_CHAT), type: "supergroup" }),
  };
}

/** The host seam the ported runtime installs its keyed stores on. */
function fakeHostRuntime(): unknown {
  const map = new Map<string, unknown>();
  const keyed = {
    register: async (key: string, value: unknown) => void map.set(key, value),
    registerIfAbsent: async (key: string, value: unknown) =>
      map.has(key) ? false : (map.set(key, value), true),
    update: async (key: string, next: (value: unknown) => unknown) => {
      const value = next(map.get(key));
      if (value === undefined) return false;
      map.set(key, value);
      return true;
    },
    lookup: async (key: string) => map.get(key),
    consume: async (key: string) => {
      const value = map.get(key);
      map.delete(key);
      return value;
    },
    delete: async (key: string) => map.delete(key),
    entries: async () => [...map].map(([key, value]) => ({ key, value, createdAt: Date.now() })),
    clear: async () => map.clear(),
  };
  return {
    state: { openKeyedStore: () => keyed },
    logging: {
      getChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    },
  };
}

/** A Telegram harness whose post and edit both run the shipped dist. */
function telegramDistHarness(calls: ApiCall[], hold?: () => Promise<void>): Harness {
  const api = fakeBotApi(calls, hold);
  const hostRuntime = fakeHostRuntime();
  const drive = { cfg: TELEGRAM_CFG, hostRuntime, accountId: "work", api };
  return harness({
    channel: "telegram",
    cfg: TELEGRAM_CFG,
    hostRuntime,
    // Only `api` is injected; the update path itself is the published dist.
    outbound: {
      updateText: async (args: Record<string, unknown>) =>
        await telegramUpdateText({ ...args, api } as never),
    },
    post: async (p) => {
      const sent = await telegramSendText({
        ...drive,
        to: p.to,
        ...(p.threadId === undefined ? {} : { threadId: p.threadId }),
        text: p.text,
      } as never);
      return { ok: true, externalMessageId: String(sent.messageId) };
    },
  });
}

function methodsOf(calls: ApiCall[], method: string): ApiCall[] {
  return calls.filter((call) => call.method === method);
}

/** The text argument of a Bot API edit (`editMessageText(chat, id, text, …)`). */
function editedText(call: ApiCall | undefined): string {
  return typeof call?.args[2] === "string" ? call.args[2] : "";
}

describe("telegram block-mode drafts on the shipped dist", () => {
  it("edits the draft in place before finalizing it", async () => {
    const calls: ApiCall[] = [];
    const { engine, clock } = telegramDistHarness(calls);
    engine.attach(
      context({
        channel: "telegram",
        conversation: TELEGRAM_CHAT,
        threadId: TELEGRAM_TOPIC,
        streaming: { mode: "block" },
      }),
    );

    await delta(engine, "turn-dist", "Sorting notes: ");
    clock.advance(1_000);
    await delta(engine, "turn-dist", "bubble, heap, ");
    clock.advance(1_000);
    await delta(engine, "turn-dist", "merge.");
    const midTurnEdits = methodsOf(calls, "editMessageText").length;
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-dist" });

    assert.ok(midTurnEdits >= 1, `the draft is edited while the turn runs (got ${midTurnEdits})`);
    assert.equal(methodsOf(calls, "sendMessage").length, 1, "only the draft's first post is sent");
    const edits = methodsOf(calls, "editMessageText");
    // The ported render path trims a page's trailing whitespace.
    assert.equal(editedText(edits.at(0)), "Sorting notes: bubble, heap,");
    assert.equal(
      editedText(edits.at(-1)),
      "Sorting notes: bubble, heap, merge.",
      "the finalize edit carries the whole answer, in the draft's own message",
    );
    assert.deepEqual(await ledgerRows(TELEGRAM_CHAT), [
      { status: "posted", externalMessageId: "1" },
    ]);
  });

  it("keeps the draft when a delta overtakes its first post", async () => {
    const calls: ApiCall[] = [];
    let open = (): void => {};
    const posted = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { engine, clock } = telegramDistHarness(calls, async () => await posted);
    engine.attach(
      context({
        channel: "telegram",
        conversation: `${TELEGRAM_CHAT}1`,
        threadId: TELEGRAM_TOPIC,
        streaming: { mode: "block" },
      }),
    );

    // Both deltas are in the producer before the first post resolves — the
    // shape the supervisor's `void plane.onStreamEvent(…)` dispatch creates.
    const first = delta(engine, "turn-race", "P");
    const overtaking = delta(engine, "turn-race", "ONG-W1TG7");
    open();
    await Promise.all([first, overtaking]);
    clock.advance(1_000);
    await delta(engine, "turn-race", " done");
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-race" });

    assert.ok(
      methodsOf(calls, "editMessageText").length >= 1,
      "the overtaking delta must not retire the draft",
    );
    assert.equal(
      methodsOf(calls, "sendMessage").length,
      1,
      "the answer lands in the draft, not in a fresh message beside a stub",
    );
    assert.equal(editedText(methodsOf(calls, "editMessageText").at(-1)), "PONG-W1TG7 done");
  });

  it("finalizes an over-cap answer as its first message instead of a stub", async () => {
    const calls: ApiCall[] = [];
    const { engine, clock } = telegramDistHarness(calls);
    engine.attach(
      context({
        channel: "telegram",
        conversation: `${TELEGRAM_CHAT}2`,
        threadId: TELEGRAM_TOPIC,
        streaming: { mode: "block" },
      }),
    );

    await delta(engine, "turn-long", "Head.\n");
    clock.advance(1_000);
    // Past Telegram's 4096-char draft cap: the draft stops taking pushes.
    await delta(engine, "turn-long", "x".repeat(5_000));
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-long" });

    const edits = methodsOf(calls, "editMessageText");
    assert.equal(edits.length, 1, "the draft is finalized with one edit");
    assert.equal(editedText(edits[0]).length, 4_096, "the draft carries a full first message");
    assert.ok(
      editedText(edits[0]).startsWith("Head.\n"),
      "the draft keeps the answer's own opening, not a one-token stub",
    );
    const sends = methodsOf(calls, "sendMessage");
    assert.equal(sends.length, 2, "the draft's post, then the remainder");
    assert.equal(
      `${editedText(edits[0])}${String(sends[1]?.args[1] ?? "")}`.length,
      5_006,
      "the draft and the remainder together are the whole answer",
    );
  });
});

describe("streaming off", () => {
  it("posts one final answer when no route authored sync.streaming", async () => {
    const calls: Call[] = [];
    const { engine, clock, posts } = harness({ outbound: slackOutbound(calls) });
    engine.attach(context({ conversation: "C0OFF", streaming: undefined }));

    await delta(engine, "turn-off", "Hel");
    clock.advance(1_000);
    await delta(engine, "turn-off", "lo");
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-off" });

    assert.deepEqual(calls, []);
    assert.deepEqual(
      posts.map((post) => post.text),
      ["Hello"],
    );
    assert.deepEqual(await ledgerRows("C0OFF"), [
      { status: "posted", externalMessageId: "1720000000.000001" },
    ]);
  });

  it("mounts no producer at all when the vertical exposes no primitive", async () => {
    const { engine, posts } = harness({ outbound: { sendText: () => undefined } });
    engine.attach(context({ conversation: "C0BARE", streaming: { mode: "partial" } }));

    await delta(engine, "turn-bare", "answer");
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-bare" });

    assert.deepEqual(
      posts.map((post) => post.text),
      ["answer"],
    );
  });
});

describe("progress mode", () => {
  it("renders a running tool call through the vertical's progress blocks", async () => {
    const calls: Call[] = [];
    const { engine, posts } = harness({ outbound: slackOutbound(calls) });
    engine.attach(context({ conversation: "C0PROG", streaming: { mode: "progress" } }));

    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-progress",
      item: { type: "tool_call", name: "bash", status: "running" },
    });

    const rendered = calls.filter((call) => call.name === "progressBlocks");
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0]?.args["state"], "working");
    assert.equal(rendered[0]?.args["title"], "Running bash…");
    const progressPost = posts.find((post) => post.blocks !== undefined);
    assert.ok(progressPost, "the progress card is posted with native blocks");
    assert.equal(progressPost?.text, "Running bash…");
  });

  // The first progress event's POST is on the wire before the message has an
  // id, so a second event that arrives during it used to post a SECOND progress
  // message instead of editing the first.
  it("keeps one progress message when two tool calls arrive together", async () => {
    const calls: Call[] = [];
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    const { engine, posts } = harness({
      outbound: slackOutbound(calls),
      post: async (post) => {
        if (post.blocks !== undefined && !held) {
          held = true;
          await gate;
        }
        return { ok: true, externalMessageId: "1720000000.000700" };
      },
    });
    engine.attach(context({ conversation: "C0PROG3", streaming: { mode: "progress" } }));

    const running = (name: string) =>
      engine.onStream(AGENT_ID, {
        kind: "timeline",
        turnId: "turn-progress-3",
        item: { type: "tool_call", name, status: "running" },
      });
    const first = running("bash");
    const second = running("rg");
    // Let both events reach their first channel call before the post resolves.
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await Promise.all([first, second]);

    assert.equal(
      posts.filter((post) => post.blocks !== undefined).length,
      1,
      "the turn keeps one progress message",
    );
  });

  it("does not draft the answer in progress mode", async () => {
    const calls: Call[] = [];
    const { engine, clock, posts } = harness({ outbound: slackOutbound(calls) });
    engine.attach(context({ conversation: "C0PROG2", streaming: { mode: "progress" } }));

    await delta(engine, "turn-progress-2", "Hel");
    clock.advance(1_000);
    await delta(engine, "turn-progress-2", "lo");
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-progress-2" });

    assert.deepEqual(calls, [], "no draft is opened for the answer text");
    assert.deepEqual(
      posts.map((post) => post.text),
      ["Hello"],
    );
  });
});
