// COMPAT(clisbot-channels): targeted tests for the relay engine (plan §4-S5).
// Drives the real ChannelStore (embedded PGlite) against an injected `post` to
// prove the record-before-post ledger: a final answer posts once, progress is
// throttled, `sync` knobs gate each event kind, and a replayed or restarted
// stream never double-posts (the ledger dedupes by event/turn id + sequence).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
  OutboundPostParams,
  OutboundPostResult,
  PlaneLogger,
  StreamContext,
} from "../plane/types.js";
import { ManualClock } from "../plane/clock.js";
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

function defaults(overrides: Partial<EffectiveDefaults> = {}): EffectiveDefaults {
  return {
    requireMention: true,
    followUp: { mode: "auto", ttlMinutes: 60 },
    bindingKey: "thread",
    replyAnchor: "thread",
    sync: { finalAnswers: true, progress: false, toolCalls: false, threadLink: "final-only" },
    ...overrides,
  };
}

function context(
  overrides: {
    route?: CompiledRoute;
    externalConversationId?: string;
    externalThreadId?: string | null;
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
    secretRef: "secret-ref",
    transport: {},
    defaultRoles: [],
    assignments: [],
    defaults: route.defaults,
    approval: [],
    routes: [route],
    fallback: { deny: true },
  };
  return {
    agentId: AGENT_ID,
    channel: "slack",
    accountId: "work",
    externalConversationId: overrides.externalConversationId ?? CONVERSATION,
    externalThreadId:
      overrides.externalThreadId === undefined ? THREAD : overrides.externalThreadId,
    initiator: "slack:U0ALICE",
    account,
    route,
  };
}

function makeEngine(
  store: ChannelStore,
  post: (p: OutboundPostParams) => Promise<OutboundPostResult>,
  clock = new ManualClock(),
) {
  return new RelayEngine({
    organizationId: ORGANIZATION_ID,
    logger: SILENT,
    clock,
    store,
    post,
    progressThrottleMs: DEFAULT_PROGRESS_THROTTLE_MS,
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
  it("posts the joined assistant text on turn_completed, once", async () => {
    const posted: string[] = [];
    const engine = makeEngine(store, async (p) => {
      posted.push(p.text);
      return { ok: true, externalMessageId: "1720000000.000001" };
    });
    const ctx = context({ externalConversationId: "C0A", externalThreadId: "1.0" });
    engine.attach(ctx);

    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-a",
      item: { type: "assistant_message", text: "step one" },
    });
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-a",
      item: { type: "assistant_message", text: "step two" },
    });
    await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId: "turn-a" });

    assert.deepEqual(posted, ["step one\n\nstep two"]);
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
          sync: { finalAnswers: false, progress: false, toolCalls: false, threadLink: "none" },
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
  it("posts a progress snapshot when sync.progress is on, throttled by the clock", async () => {
    const clock = new ManualClock(0);
    const posted: string[] = [];
    const ctx = context({
      externalConversationId: "C0D",
      externalThreadId: "4.0",
      route: {
        ...context().route,
        defaults: defaults({
          sync: { finalAnswers: true, progress: true, toolCalls: false, threadLink: "none" },
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
          sync: { finalAnswers: true, progress: false, toolCalls: true, threadLink: "none" },
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
          sync: { finalAnswers: true, progress: true, toolCalls: false, threadLink: "none" },
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

  it("reply location honors the anchor", () => {
    assert.deepEqual(replyLocationFor(context({ externalThreadId: THREAD })), {
      to: CONVERSATION,
      threadId: THREAD,
    });
    const channelAnchor = context({
      route: { ...context().route, defaults: defaults({ replyAnchor: "channel" }) },
    });
    assert.deepEqual(replyLocationFor(channelAnchor), { to: CONVERSATION });
  });
});
