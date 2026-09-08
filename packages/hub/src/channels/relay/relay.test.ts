// COMPAT(clisbot-channels): targeted tests for the relay engine (plan §4-S5).
// Drives the real ChannelStore (embedded PGlite) against an injected `post` to
// prove the record-before-post ledger: a final answer posts once, progress is
// throttled, `sync` knobs gate each event kind, and a replayed or restarted
// stream never double-posts (the ledger dedupes by event/turn id + sequence).
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ChannelStore } from "../../db/channels.js";
import { embeddedDatabaseRuntime } from "../../db/runtime/index.js";
import type { DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import type {
  CompiledChannelAccount,
  CompiledRoute,
  EffectiveDefaults,
} from "../config/compile.js";
import type {
  MediaPostFn,
  OutboundPostParams,
  OutboundPostResult,
  SupportedChannelName,
  PlaneLogger,
  StreamContext,
  TypingParams,
} from "../plane/types.js";
import type { ProcessingController } from "../plane/processing.js";
import { ManualClock } from "../plane/clock.js";
import { createProcessingController, processingSurfaceFor } from "../plane/processing.js";
import {
  DEFAULT_PROGRESS_THROTTLE_MS,
  RelayEngine,
  appendThreadLink,
  replyLocationFor,
} from "./index.js";

const ORGANIZATION_ID = "channel-org";
const AGENT_ID = "agent-1";
const CONVERSATION = "C0APP";
const THREAD = "1720000000.000000";
const SILENT: PlaneLogger = { warn: () => undefined, info: () => undefined };

/** The subagent relay knobs at the org floor (all off). */
const SUBAGENTS_OFF = { finalAnswers: false, progress: false, toolCalls: false };

function defaults(overrides: Partial<EffectiveDefaults> = {}): EffectiveDefaults {
  return {
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
    ...overrides,
  };
}

function context(
  overrides: {
    agentId?: string;
    channel?: SupportedChannelName;
    route?: CompiledRoute;
    externalConversationId?: string;
    externalThreadId?: string | null;
    triggerThreadId?: string | null;
    triggerMessageId?: string;
    deliveryScopeId?: string;
    rootKind?: StreamContext["rootKind"];
    outputDelivery?: StreamContext["outputDelivery"];
  } = {},
): StreamContext {
  const route: CompiledRoute = overrides.route ?? {
    match: { kind: "channel", ids: [CONVERSATION] },
    target: { kind: "agent", agent: "worker", environment: "repo", template: null },
    defaultRoles: [],
    assignments: [],
    defaults: defaults(),
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
    fallback: { deny: true },
  };
  return {
    agentId: overrides.agentId ?? AGENT_ID,
    ...(overrides.deliveryScopeId === undefined
      ? {}
      : { deliveryScopeId: overrides.deliveryScopeId }),
    channel: overrides.channel ?? "slack",
    accountId: "work",
    externalConversationId: overrides.externalConversationId ?? CONVERSATION,
    externalThreadId:
      overrides.externalThreadId === undefined ? THREAD : overrides.externalThreadId,
    ...(overrides.triggerThreadId !== undefined
      ? { triggerThreadId: overrides.triggerThreadId }
      : {}),
    ...(overrides.triggerMessageId !== undefined
      ? { triggerMessageId: overrides.triggerMessageId }
      : {}),
    initiator: "slack:U0ALICE",
    account,
    route,
    // The binding's stored route-summary kind: a Slack thread's root is a
    // channel.
    rootKind: overrides.rootKind ?? "channel",
    ...(overrides.outputDelivery === undefined ? {} : { outputDelivery: overrides.outputDelivery }),
  };
}

function makeEngine(
  store: ChannelStore,
  post: (p: OutboundPostParams) => Promise<OutboundPostResult>,
  clock = new ManualClock(),
  media: {
    mediaPost?: MediaPostFn | undefined;
    homeRoot?: string | undefined;
    agentCwd?: ((agentId: string) => string | undefined) | undefined;
    processing?: ProcessingController | undefined;
  } = {},
) {
  return new RelayEngine({
    organizationId: ORGANIZATION_ID,
    logger: SILENT,
    clock,
    store,
    post,
    progressThrottleMs: DEFAULT_PROGRESS_THROTTLE_MS,
    ...(media.processing !== undefined ? { processing: media.processing } : {}),
  });
}

// --- Harness ---------------------------------------------------------------

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-relay-db-"));
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

describe("relay final answer", () => {
  it("accounts a successful automatic relay against the Workflow output limit", async () => {
    const calls: string[] = [];
    const engine = makeEngine(store, async () => ({ ok: true }));
    engine.attach(
      context({
        externalConversationId: "C0OUTPUT",
        externalThreadId: "output.1",
        outputDelivery: {
          begin: async () => {
            calls.push("begin");
            return "attempt-1";
          },
          complete: async (id) => {
            calls.push(`complete:${id}`);
          },
          fail: async (id) => {
            calls.push(`fail:${id}`);
          },
        },
      }),
    );
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-output",
      item: { type: "assistant_message", messageId: "m-output", text: "done" },
    });
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-output" });
    assert.deepEqual(calls, ["begin", "complete:attempt-1"]);
  });

  it("posts one message's coalesced items as a single post on turn_completed", async () => {
    const posted: string[] = [];
    const engine = makeEngine(store, async (p) => {
      posted.push(p.text);
      return { ok: true, externalMessageId: "1720000000.000001" };
    });
    const ctx = context({ externalConversationId: "C0A", externalThreadId: "1.0" });
    engine.attach(ctx);

    // One logical message, coalesced by the daemon into two wire items with the
    // same messageId (the 60ms window can split a message mid-word).
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-a",
      item: { type: "assistant_message", messageId: "m1", text: "step on" },
    });
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-a",
      item: { type: "assistant_message", messageId: "m1", text: "e" },
    });
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-a" });

    assert.deepEqual(posted, ["step one"]);
  });

  it("does not re-post one assistant message replayed after a terminal tool call", async () => {
    const posted: string[] = [];
    const engine = makeEngine(store, async (post) => {
      posted.push(post.text);
      return { ok: true };
    });
    engine.attach(context({ externalConversationId: "C0R", externalThreadId: "1.1" }));

    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-replayed-message",
      item: { type: "assistant_message", messageId: "m1", text: "answer" },
    });
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-replayed-message",
      item: { type: "tool_call", name: "finish_execution", status: "completed" },
    });
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-replayed-message",
      item: { type: "assistant_message", messageId: "m1", text: "answer" },
    });
    await engine.onStream(AGENT_ID, {
      kind: "turn_completed",
      turnId: "turn-replayed-message",
    });

    assert.deepEqual(posted, ["answer"]);
  });

  it("does not re-post identical assistant text when a replay changes messageId", async () => {
    const posted: string[] = [];
    const engine = makeEngine(store, async (post) => {
      posted.push(post.text);
      return { ok: true };
    });
    engine.attach(context({ externalConversationId: "C0S", externalThreadId: "1.2" }));

    for (const messageId of ["m1", "m2"]) {
      await engine.onStream(AGENT_ID, {
        kind: "timeline",
        turnId: "turn-message-id-drift",
        item: { type: "assistant_message", messageId, text: "answer" },
      });
      await engine.onStream(AGENT_ID, {
        kind: "timeline",
        turnId: "turn-message-id-drift",
        item: { type: "tool_call", name: "finish_execution", status: "completed" },
      });
    }

    assert.deepEqual(posted, ["answer"]);
  });

  it("posts two messages with different messageIds as two separate posts, in order", async () => {
    const posted: string[] = [];
    const engine = makeEngine(store, async (p) => {
      posted.push(p.text);
      return { ok: true };
    });
    const ctx = context({ externalConversationId: "C0H", externalThreadId: "8.0" });
    engine.attach(ctx);

    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-h",
      item: { type: "assistant_message", messageId: "m1", text: "first" },
    });
    // A new messageId closes the first message (posted first, in order).
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-h",
      item: { type: "assistant_message", messageId: "m2", text: "second" },
    });
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-h" });

    assert.deepEqual(posted, ["first", "second"]);
  });

  it("interleaves two agents' turns without leaking state between them", async () => {
    const posted = new Map<string, string[]>();
    const engine = makeEngine(store, async (p) => {
      const list = posted.get(p.threadId ?? "") ?? [];
      list.push(p.text);
      posted.set(p.threadId ?? "", list);
      return { ok: true };
    });
    engine.attach(
      context({ agentId: "agent-A", externalConversationId: "C0I", externalThreadId: "9.0" }),
    );
    engine.attach(
      context({ agentId: "agent-B", externalConversationId: "C0I", externalThreadId: "10.0" }),
    );

    // Interleave: A's message m1, B's message m1, A's next message m2, B's
    // continuation of m1 — per-agent (and per-turn) state must not mix.
    await engine.onStream("agent-A", {
      kind: "timeline",
      turnId: "turn-A",
      item: { type: "assistant_message", messageId: "m1", text: "A one" },
    });
    await engine.onStream("agent-B", {
      kind: "timeline",
      turnId: "turn-B",
      item: { type: "assistant_message", messageId: "m1", text: "B one" },
    });
    await engine.onStream("agent-A", {
      kind: "timeline",
      turnId: "turn-A",
      item: { type: "assistant_message", messageId: "m2", text: "A two" },
    });
    await engine.onStream("agent-B", {
      kind: "timeline",
      turnId: "turn-B",
      item: { type: "assistant_message", messageId: "m1", text: "B two" },
    });
    await engine.onStream("agent-A", { kind: "turn_completed", turnId: "turn-A" });
    await engine.onStream("agent-B", { kind: "turn_completed", turnId: "turn-B" });

    assert.deepEqual(posted.get("9.0"), ["A one", "A two"]);
    assert.deepEqual(posted.get("10.0"), ["B oneB two"]);
  });

  it("strips the provider boundary marker, even when the message is only marker + text", async () => {
    const posted: string[] = [];
    const engine = makeEngine(store, async (p) => {
      posted.push(p.text);
      return { ok: true };
    });
    const ctx = context({ externalConversationId: "C0J", externalThreadId: "11.0" });
    engine.attach(ctx);

    // The Codex provider prepends "\n\n---\n\n" to the first delta of each new
    // assistant message; the relay must not surface the marker.
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-j",
      item: { type: "assistant_message", messageId: "m1", text: "hello" },
    });
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-j",
      item: { type: "assistant_message", messageId: "m2", text: "\n\n---\n\nworld" },
    });
    // A message whose only content is the marker posts nothing.
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-j",
      item: { type: "assistant_message", messageId: "m3", text: "\n\n---\n\n" },
    });
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-j" });

    assert.deepEqual(posted, ["hello", "world"]);
  });

  it("posts into the native thread for reply.anchor = thread", async () => {
    const posted: OutboundPostParams[] = [];
    const engine = makeEngine(store, async (p) => {
      posted.push(p);
      return { ok: true };
    });
    const ctx = context({ externalConversationId: "C0B", externalThreadId: "2.0" });
    engine.attach(ctx);
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-b",
      item: { type: "assistant_message", text: "hi" },
    });
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-b" });

    assert.equal(posted[0]?.to, "C0B");
    assert.equal(posted[0]?.threadId, "2.0", "the final answer lands in the thread");
  });

  it("does not post when sync.finalAnswers is off", async () => {
    let calls = 0;
    const engine = makeEngine(store, async () => {
      calls += 1;
      return { ok: true };
    });
    const ctx = context({
      externalConversationId: "C0C",
      externalThreadId: "3.0",
      route: {
        ...context().route,
        defaults: defaults({
          sync: {
            finalAnswers: false,
            progress: { progressMessage: false, typingIndicator: false, messageReaction: "off" },
            toolCalls: false,
            threadLink: "none",
            subagents: SUBAGENTS_OFF,
          },
        }),
      },
    });
    engine.attach(ctx);
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-c",
      item: { type: "assistant_message", text: "hi" },
    });
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-c" });
    assert.equal(calls, 0, "no post when final answers are off");
  });
});

describe("relay progress + tool calls", () => {
  it("never exposes the Hub finish_execution control tool", async () => {
    const posted: string[] = [];
    const ctx = context({
      externalConversationId: "C0INTERNAL",
      externalThreadId: "3.5",
      route: {
        ...context().route,
        defaults: defaults({
          sync: {
            finalAnswers: true,
            progress: { progressMessage: true, typingIndicator: false, messageReaction: "off" },
            toolCalls: true,
            threadLink: "none",
            subagents: SUBAGENTS_OFF,
          },
        }),
      },
    });
    const engine = makeEngine(store, async (post) => {
      posted.push(post.text);
      return { ok: true };
    });
    engine.attach(ctx);

    for (const name of ["hub.finish_execution", "mcp__hub__finish_execution"]) {
      await engine.onStream(AGENT_ID, {
        kind: "timeline",
        turnId: `turn-${name}`,
        item: { type: "tool_call", name, status: "running" },
      });
      await engine.onStream(AGENT_ID, {
        kind: "timeline",
        turnId: `turn-${name}`,
        item: { type: "tool_call", name, status: "completed" },
      });
    }

    assert.deepEqual(posted, []);
  });

  it("posts a progress snapshot when sync.progress is on, throttled by the clock", async () => {
    const clock = new ManualClock(0);
    const posted: string[] = [];
    const ctx = context({
      externalConversationId: "C0D",
      externalThreadId: "4.0",
      route: {
        ...context().route,
        defaults: defaults({
          sync: {
            finalAnswers: true,
            progress: { progressMessage: true, typingIndicator: false, messageReaction: "off" },
            toolCalls: false,
            threadLink: "none",
            subagents: SUBAGENTS_OFF,
          },
        }),
      },
    });
    const engine = makeEngine(
      store,
      async (p) => {
        posted.push(p.text);
        return { ok: true };
      },
      clock,
    );
    engine.attach(ctx);

    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-d",
      item: { type: "tool_call", name: "Bash", status: "running" },
    });
    // Within the 30s throttle window: held.
    clock.advance(10_000);
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-d",
      item: { type: "tool_call", name: "Bash", status: "running" },
    });
    // Past the window: the next eligible event posts.
    clock.advance(25_000);
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-d",
      item: { type: "tool_call", name: "Bash", status: "running" },
    });

    assert.equal(posted.length, 2, "throttle lets one snapshot per window through");
    assert.match(posted[0] ?? "", /Running Bash/u);
  });

  it("posts a terminal tool-call line when sync.toolCalls is on", async () => {
    const posted: string[] = [];
    const ctx = context({
      externalConversationId: "C0E",
      externalThreadId: "5.0",
      route: {
        ...context().route,
        defaults: defaults({
          sync: {
            finalAnswers: true,
            progress: { progressMessage: false, typingIndicator: false, messageReaction: "off" },
            toolCalls: true,
            threadLink: "none",
            subagents: SUBAGENTS_OFF,
          },
        }),
      },
    });
    const engine = makeEngine(store, async (p) => {
      posted.push(p.text);
      return { ok: true };
    });
    engine.attach(ctx);
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-e",
      item: { type: "tool_call", name: "Edit", status: "completed" },
    });
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-e" });
    assert.ok(posted.includes("Tool Edit: completed"), "terminal tool-call line posted");
  });
});

describe("ledger dedupe (restart / replay)", () => {
  it("never double-posts a final answer when the stream is replayed", async () => {
    let posts = 0;
    const post = async (): Promise<OutboundPostResult> => {
      posts += 1;
      return { ok: true, externalMessageId: "1720000000.000001" };
    };
    const ctx = context({ externalConversationId: "C0F", externalThreadId: "6.0" });
    const first = makeEngine(store, post);
    first.attach(ctx);
    await first.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-f",
      item: { type: "assistant_message", text: "answer" },
    });
    await first.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-f" });
    assert.equal(posts, 1);

    // A restarted plane re-attaches the same agent + replayed the same event.
    const second = makeEngine(store, post);
    second.attach(ctx);
    await second.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-f",
      item: { type: "assistant_message", text: "answer" },
    });
    await second.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-f" });
    assert.equal(posts, 1, "the replayed final answer does not re-post");
  });

  it("does not collide when a reused Agent restarts its provider-local turn id", async () => {
    let posts = 0;
    const post = async (): Promise<OutboundPostResult> => {
      posts += 1;
      return { ok: true, externalMessageId: String(posts) };
    };
    const base = {
      channel: "telegram" as const,
      externalConversationId: "telegram-root",
      externalThreadId: null,
    };

    for (const deliveryScopeId of ["execution-one", "execution-two"]) {
      const engine = makeEngine(store, post);
      engine.attach(context({ ...base, deliveryScopeId }));
      await engine.onStream(AGENT_ID, {
        kind: "timeline",
        turnId: "codex-turn-0",
        item: { type: "assistant_message", text: deliveryScopeId },
      });
      await engine.onStream(AGENT_ID, {
        kind: "turn_completed",
        turnId: "codex-turn-0",
      });
    }

    assert.equal(posts, 2, "each Workflow execution owns a distinct delivery scope");

    const replay = makeEngine(store, post);
    replay.attach(context({ ...base, deliveryScopeId: "execution-two" }));
    await replay.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "codex-turn-0",
      item: { type: "assistant_message", text: "execution-two" },
    });
    await replay.onStream(AGENT_ID, {
      kind: "turn_completed",
      turnId: "codex-turn-0",
    });
    assert.equal(posts, 2, "replaying the same Workflow execution remains idempotent");
  });

  it("retries a known failed post once while preserving replay dedupe", async () => {
    let calls = 0;
    const post = async (): Promise<OutboundPostResult> => {
      calls += 1;
      return calls === 1
        ? { ok: false, error: "rate limited" }
        : { ok: true, externalMessageId: "telegram-1" };
    };
    const ctx = context({
      channel: "telegram",
      deliveryScopeId: "execution-retry",
      externalConversationId: "telegram-retry",
      externalThreadId: null,
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const engine = makeEngine(store, post);
      engine.attach(ctx);
      await engine.onStream(AGENT_ID, {
        kind: "timeline",
        turnId: "codex-turn-0",
        item: { type: "assistant_message", text: "retry me" },
      });
      await engine.onStream(AGENT_ID, {
        kind: "turn_completed",
        turnId: "codex-turn-0",
      });
    }

    assert.equal(calls, 2, "failure retries once; replay after success stays silent");
  });

  it("does not re-post a progress snapshot on replay (dedupe by sequence)", async () => {
    let posts = 0;
    const post = async (): Promise<OutboundPostResult> => {
      posts += 1;
      return { ok: true, externalMessageId: "1720000000.000002" };
    };
    const ctx = context({
      externalConversationId: "C0G",
      externalThreadId: "7.0",
      route: {
        ...context().route,
        defaults: defaults({
          sync: {
            finalAnswers: true,
            progress: { progressMessage: true, typingIndicator: false, messageReaction: "off" },
            toolCalls: false,
            threadLink: "none",
            subagents: SUBAGENTS_OFF,
          },
        }),
      },
    });
    const first = makeEngine(store, post, new ManualClock(0));
    first.attach(ctx);
    await first.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-g",
      item: { type: "tool_call", name: "Bash", status: "running" },
    });
    assert.equal(posts, 1);

    const second = makeEngine(store, post, new ManualClock(0));
    second.attach(ctx);
    await second.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-g",
      item: { type: "tool_call", name: "Bash", status: "running" },
    });
    assert.equal(posts, 1, "the replayed progress snapshot does not re-post");
  });
});

describe("relay subagent scope", () => {
  function subagentRoute(
    finalAnswers: boolean,
    extra: Partial<EffectiveDefaults["sync"]["subagents"]> = {},
  ) {
    return {
      ...context().route,
      defaults: defaults({
        sync: {
          finalAnswers: true,
          progress: { progressMessage: false, typingIndicator: false, messageReaction: "off" },
          toolCalls: false,
          threadLink: "none",
          subagents: { finalAnswers, progress: false, toolCalls: false, ...extra },
        },
      }),
    };
  }

  it("posts a subagent's coalesced answer with the label prefix, into the original thread", async () => {
    const posted: OutboundPostParams[] = [];
    const engine = makeEngine(store, async (p) => {
      posted.push(p);
      return { ok: true };
    });
    engine.attach(
      context({
        externalConversationId: "C0K",
        externalThreadId: "12.0",
        route: subagentRoute(true),
      }),
    );

    await engine.onSubagentStream({
      kind: "upsert",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      label: "Research",
      status: "running",
    });
    // One logical message coalesced across two wire items (same messageId).
    await engine.onSubagentStream({
      kind: "timeline",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      item: { type: "assistant_message", messageId: "m1", text: "found" },
    });
    await engine.onSubagentStream({
      kind: "timeline",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      item: { type: "assistant_message", messageId: "m1", text: " it" },
    });
    // A second message with the provider boundary marker; `remove` closes it.
    await engine.onSubagentStream({
      kind: "timeline",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      item: { type: "assistant_message", messageId: "m2", text: "\n\n---\n\ndone" },
    });
    await engine.onSubagentStream({
      kind: "remove",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
    });

    assert.equal(posted.length, 2);
    assert.equal(posted[0]?.text, "▶ Research (subagent): found it");
    assert.equal(posted[1]?.text, "▶ Research (subagent): done");
    // The subagent posts land in the parent's conversation + thread.
    assert.equal(posted[0]?.to, "C0K");
    assert.equal(posted[0]?.threadId, "12.0");
  });

  it("falls back to the subagentId when the upsert carries no label", async () => {
    const posted: string[] = [];
    const engine = makeEngine(store, async (p) => {
      posted.push(p.text);
      return { ok: true };
    });
    engine.attach(
      context({
        externalConversationId: "C0K1",
        externalThreadId: "12.1",
        route: subagentRoute(true),
      }),
    );
    await engine.onSubagentStream({
      kind: "upsert",
      parentAgentId: AGENT_ID,
      subagentId: "sub-9",
      label: null,
      status: "running",
    });
    await engine.onSubagentStream({
      kind: "timeline",
      parentAgentId: AGENT_ID,
      subagentId: "sub-9",
      item: { type: "assistant_message", text: "x" },
    });
    await engine.onSubagentStream({
      kind: "remove",
      parentAgentId: AGENT_ID,
      subagentId: "sub-9",
    });
    assert.deepEqual(posted, ["▶ sub-9 (subagent): x"]);
  });

  it("interleaves root + subagent posts in order, with separate ledger sequences; replay is safe", async () => {
    let posts = 0;
    const engine = makeEngine(store, async () => {
      posts += 1;
      return { ok: true };
    });
    const ctx = context({
      externalConversationId: "C0L",
      externalThreadId: "13.0",
      route: subagentRoute(true),
    });
    engine.attach(ctx);

    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-r",
      item: { type: "assistant_message", messageId: "m1", text: "root one" },
    });
    await engine.onSubagentStream({
      kind: "upsert",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      label: "Helper",
      status: "running",
    });
    await engine.onSubagentStream({
      kind: "timeline",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      item: { type: "assistant_message", messageId: "m1", text: "sub one" },
    });
    // A new root messageId closes the root's first message (root seq 0).
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-r",
      item: { type: "assistant_message", messageId: "m2", text: "root two" },
    });
    // A new subagent messageId closes the subagent's first (sub seq 0).
    await engine.onSubagentStream({
      kind: "timeline",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      item: { type: "assistant_message", messageId: "m2", text: "sub two" },
    });
    // The subagent ends before the root turn: its close posts "sub two" (sub seq 1).
    await engine.onSubagentStream({
      kind: "remove",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
    });
    // The root turn completes last: "root two" (root seq 1).
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-r" });

    assert.equal(posts, 4, "root and subagent posts interleave, none lost or merged");

    // A restarted plane replays the same root + subagent frames: the ledger's
    // subagent scope key keeps the replay deduped against the subagent posts
    // (and the root scope key against the root's).
    const replay = makeEngine(store, async () => {
      posts += 1;
      return { ok: true };
    });
    replay.attach(ctx);
    await replay.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-r",
      item: { type: "assistant_message", messageId: "m1", text: "root one" },
    });
    await replay.onSubagentStream({
      kind: "upsert",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      label: "Helper",
      status: "running",
    });
    await replay.onSubagentStream({
      kind: "timeline",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      item: { type: "assistant_message", messageId: "m1", text: "sub one" },
    });
    await replay.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-r",
      item: { type: "assistant_message", messageId: "m2", text: "root two" },
    });
    await replay.onSubagentStream({
      kind: "timeline",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      item: { type: "assistant_message", messageId: "m2", text: "sub two" },
    });
    await replay.onSubagentStream({
      kind: "remove",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
    });
    await replay.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-r" });

    assert.equal(posts, 4, "replayed root + subagent frames do not re-post");
  });

  it("does not relay subagent text when sync.subagents is off (the default)", async () => {
    const posted: string[] = [];
    const engine = makeEngine(store, async (p) => {
      posted.push(p.text);
      return { ok: true };
    });
    // Root finalAnswers on, subagents all off — the org-floor default.
    engine.attach(context({ externalConversationId: "C0M", externalThreadId: "14.0" }));
    await engine.onSubagentStream({
      kind: "upsert",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      label: "Hidden",
      status: "running",
    });
    await engine.onSubagentStream({
      kind: "timeline",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      item: { type: "assistant_message", text: "never relayed" },
    });
    await engine.onSubagentStream({
      kind: "remove",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
    });
    // The root turn still relays normally.
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-m",
      item: { type: "assistant_message", text: "root" },
    });
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-m" });

    assert.deepEqual(posted, ["root"], "the subagent's text stays off the channel");
  });

  it("posts prefixed subagent tool-call lines when sync.subagents.toolCalls is on", async () => {
    const posted: string[] = [];
    const engine = makeEngine(store, async (p) => {
      posted.push(p.text);
      return { ok: true };
    });
    engine.attach(
      context({
        externalConversationId: "C0N",
        externalThreadId: "15.0",
        route: subagentRoute(true, { toolCalls: true }),
      }),
    );
    await engine.onSubagentStream({
      kind: "upsert",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      label: "Worker",
      status: "running",
    });
    await engine.onSubagentStream({
      kind: "timeline",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
      item: { type: "tool_call", name: "Bash", status: "completed" },
    });
    await engine.onSubagentStream({
      kind: "remove",
      parentAgentId: AGENT_ID,
      subagentId: "sub-1",
    });
    assert.deepEqual(posted, ["▶ Worker (subagent): Tool Bash: completed"]);
  });
});

describe("relay outbound text contract (retired media heuristics)", () => {
  /** One temp dir holding the file the final answer references. */
  let mediaHome: string;

  beforeAll(async () => {
    mediaHome = await mkdtemp(join(tmpdir(), "hub-relay-media-"));
    await writeFile(join(mediaHome, "chart.png"), "png");
  });

  afterAll(async () => {
    await rm(mediaHome, { recursive: true, force: true });
  });

  it("posts local paths as plain text and never calls a media seam", async () => {
    const posted: string[] = [];
    const mediaPath = join(mediaHome, "chart.png");
    const engine = makeEngine(
      store,
      async (p) => {
        posted.push(p.text);
        return { ok: true };
      },
      new ManualClock(),
      // The relay never parses final-answer text for media.
      { homeRoot: mediaHome, mediaPost: undefined },
    );
    engine.attach(context({ externalConversationId: "C0O", externalThreadId: "16.0" }));
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-o",
      item: { type: "assistant_message", text: `done, see ${mediaPath}` },
    });
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-o" });

    assert.deepEqual(posted, [`done, see ${mediaPath}`]);
  });
});

describe("thread link + reply location (pure)", () => {
  it("appends the link only on the final answer for final-only", () => {
    const link = appendThreadLink(
      "answer",
      "final-only",
      true,
      { sessionLink: () => "open session" },
      AGENT_ID,
    );
    assert.equal(link, "answer\n\nopen session");
    assert.equal(
      appendThreadLink(
        "progress",
        "final-only",
        false,
        { sessionLink: () => "open session" },
        AGENT_ID,
      ),
      "progress",
    );
    assert.equal(
      appendThreadLink("answer", "none", true, { sessionLink: () => "open session" }, AGENT_ID),
      "answer",
    );
  });

  it("reply location follows the marker", () => {
    // A thread-keyed binding (`binding.key: thread`): the persisted thread
    // wins under either anchor.
    assert.deepEqual(replyLocationFor(context({ externalThreadId: THREAD })), {
      to: CONVERSATION,
      threadId: THREAD,
    });
    // `default`: a thread marker follows its thread even when the binding
    // carries no thread of its own (`binding.key: channel` collapses threads).
    const defaultAnchor = context({
      externalThreadId: null,
      triggerThreadId: THREAD,
      route: { ...context().route, defaults: defaults({ replyAnchor: "default" }) },
    });
    assert.deepEqual(replyLocationFor(defaultAnchor), {
      to: CONVERSATION,
      threadId: THREAD,
    });
    // `default`: a root marker stays at the conversation root.
    const defaultRoot = context({
      externalThreadId: null,
      route: { ...context().route, defaults: defaults({ replyAnchor: "default" }) },
    });
    assert.deepEqual(replyLocationFor(defaultRoot), { to: CONVERSATION });
  });

  it("the thread anchor mints the reply thread on a root-level Slack marker", () => {
    // Answering the marker message itself: `thread_ts` = the marker's native ts.
    const mint = context({
      externalThreadId: null,
      triggerMessageId: "1700000000.000009",
      route: { ...context().route, defaults: defaults({ replyAnchor: "thread" }) },
    });
    assert.deepEqual(replyLocationFor(mint), {
      to: CONVERSATION,
      threadId: "1700000000.000009",
    });
    // The mint is the `thread` anchor's: `default` never mints a root marker.
    const noMint = context({
      externalThreadId: null,
      triggerMessageId: "1700000000.000009",
      route: { ...context().route, defaults: defaults({ replyAnchor: "default" }) },
    });
    assert.deepEqual(replyLocationFor(noMint), { to: CONVERSATION });
    // DMs never mint (Slack DMs have no thread level).
    const dm = context({
      externalThreadId: null,
      triggerMessageId: "1700000000.000009",
      rootKind: "dm",
      route: { ...context().route, defaults: defaults({ replyAnchor: "thread" }) },
    });
    assert.deepEqual(replyLocationFor(dm), { to: CONVERSATION });
    // Non-Slack channels never mint (no native reply-to-mint API).
    const telegram = context({
      channel: "telegram",
      externalThreadId: null,
      triggerMessageId: "424242",
      route: { ...context().route, defaults: defaults({ replyAnchor: "thread" }) },
    });
    assert.deepEqual(replyLocationFor(telegram), { to: CONVERSATION });
    // A marker id outside the native Slack ts shape never mints.
    const malformed = context({
      externalThreadId: null,
      triggerMessageId: "slash:1700000000:U0",
      route: { ...context().route, defaults: defaults({ replyAnchor: "thread" }) },
    });
    assert.deepEqual(replyLocationFor(malformed), { to: CONVERSATION });
    // A restart re-attach carries no marker message id: fall back to the root.
    const noTrigger = context({
      externalThreadId: null,
      route: { ...context().route, defaults: defaults({ replyAnchor: "thread" }) },
    });
    assert.deepEqual(replyLocationFor(noTrigger), { to: CONVERSATION });
  });
});

// --- The processing-lease wiring (sync.progress liveness) -------------------
// The controller's own behavior is pinned in plane/processing.test.ts; these
// assert what the RELAY owes it: the inbound path opened the lease, the relay
// keeps it alive on stream events and releases it on the terminal event.

describe("relay processing wiring", () => {
  /** A controller whose wire is a recorder, plus the relay that shares it. */
  function processingEngine(driven: TypingParams[]) {
    const clock = new ManualClock();
    const controller = createProcessingController({
      logger: SILENT,
      now: () => clock.now(),
      drive: async (params: TypingParams) => {
        driven.push(params);
      },
    });
    const engine = makeEngine(store, async () => ({ ok: true, externalMessageId: "1" }), clock, {
      processing: controller,
    });
    return { engine, controller };
  }

  /** The lease the inbound path would have opened for this context. */
  function openLease(
    controller: ProcessingController,
    ctx: StreamContext,
    reaction: "eyes" | "off",
  ): void {
    const surface = processingSurfaceFor({
      channel: ctx.channel,
      accountId: ctx.accountId,
      sync: {
        ...ctx.route.defaults.sync,
        progress: {
          progressMessage: false,
          typingIndicator: true,
          messageReaction: reaction,
        },
      },
      to: CONVERSATION,
      threadId: THREAD,
      messageId: "1720000000.000001",
    });
    assert.ok(surface !== undefined);
    controller.open("inbound-1", surface);
    controller.bind("inbound-1", ctx.agentId);
  }

  function liveRouteCtx(reaction: "eyes" | "off"): StreamContext {
    return context({
      route: {
        ...context().route,
        defaults: defaults({
          sync: {
            ...defaults().sync,
            progress: {
              progressMessage: false,
              typingIndicator: true,
              messageReaction: reaction,
            },
          },
        }),
      },
    });
  }

  it("turn_started never raises a surface and turn_completed closes the lease", async () => {
    const driven: TypingParams[] = [];
    const { engine, controller } = processingEngine(driven);
    const ctx = liveRouteCtx("eyes");
    engine.attach(ctx);
    // The relay sees the turn's first event BEFORE the lease exists: an
    // unbound agent is a no-op, which is exactly why the inbound owns opening.
    await engine.onStream(AGENT_ID, { kind: "turn_started", turnId: "turn-a" });
    await Promise.resolve();
    assert.equal(driven.length, 0);

    openLease(controller, ctx, "eyes");
    await engine.onStream(AGENT_ID, { kind: "turn_started", turnId: "turn-a" });
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-a" });
    await Promise.resolve();
    assert.deepEqual(
      driven.map((d) => [d.action, d.to, d.threadId, d.indicator, d.reactionEmoji]),
      [
        ["start", CONVERSATION, THREAD, true, "eyes"],
        ["stop", CONVERSATION, THREAD, true, "eyes"],
      ],
    );
  });

  it("drives nothing when both liveness leaves are off (byte-identical relay)", async () => {
    const driven: TypingParams[] = [];
    const { engine } = processingEngine(driven);
    engine.attach(context());
    await engine.onStream(AGENT_ID, { kind: "turn_started", turnId: "turn-a" });
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-a" });
    await Promise.resolve();
    assert.equal(driven.length, 0);
  });

  it("closes the surface when a turn fails instead of completing", async () => {
    const driven: TypingParams[] = [];
    const { engine, controller } = processingEngine(driven);
    const ctx = liveRouteCtx("off");
    engine.attach(ctx);
    openLease(controller, ctx, "off");
    await engine.onStream(AGENT_ID, { kind: "turn_closed", turnId: "turn-a" });
    await Promise.resolve();
    assert.deepEqual(
      driven.map((d) => d.action),
      ["start", "stop"],
    );
  });

  it("detach releases the surface a running turn left open", async () => {
    const driven: TypingParams[] = [];
    const { engine, controller } = processingEngine(driven);
    const ctx = liveRouteCtx("off");
    engine.attach(ctx);
    openLease(controller, ctx, "off");
    engine.detach(AGENT_ID);
    await Promise.resolve();
    assert.deepEqual(
      driven.map((d) => d.action),
      ["start", "stop"],
    );
  });
});
