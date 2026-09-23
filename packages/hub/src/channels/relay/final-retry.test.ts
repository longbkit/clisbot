// Final answers are retried from the delivery ledger; progress is not
// (docs/features/channels/conversation-flow.md#outbound). Drives the real
// relay and ChannelStore (embedded PGlite) with a hand-advanced clock.
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
import { toolActivityDefaults } from "../config/compile.js";
import { ManualClock } from "../plane/clock.js";
import { outboundFailure, type OutboundFailureKind } from "../plane/outbound-failure.js";
import type { OutboundPostResult, PlaneLogger, PostFn, StreamContext } from "../plane/types.js";
import { RelayEngine } from "./index.js";
import {
  FinalAnswerRetrier,
  MAX_FINAL_ANSWER_ATTEMPTS,
  finalAnswerRetryDelayMs,
} from "./final-retry.js";

const ORGANIZATION_ID = "retry-org";
const AGENT_ID = "agent-retry";
const SILENT: PlaneLogger = { warn: () => undefined, info: () => undefined };
const START = Date.UTC(2026, 8, 22, 12);

function defaults(toolActivity: boolean): EffectiveDefaults {
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
      toolCalls: toolActivityDefaults(toolActivity),
      threadLink: "none",
      subagents: { finalAnswers: false, progress: false, toolCalls: false },
    },
  };
}

/** A stream context on its own account, so each test's due scan sees only its rows. */
function context(accountId: string, options: { toolActivity?: boolean } = {}): StreamContext {
  const route: CompiledRoute = {
    audienceRules: [],
    where: { dm: false, groups: [], conversations: ["C1"] },
    target: { kind: "agent", agent: "worker", environment: "repo", template: null },
    defaultRoles: [],
    assignments: [],
    defaults: defaults(options.toolActivity ?? false),
    approval: [],
  };
  const account: CompiledChannelAccount = {
    channel: "slack",
    accountId,
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
    accountId,
    externalConversationId: "C1",
    externalThreadId: "1.0",
    initiator: "slack:U0ALICE",
    account,
    route,
    rootKind: "channel",
  };
}

function failed(kind: OutboundFailureKind): OutboundPostResult {
  return { ok: false, error: `post failed: ${kind}`, failure: outboundFailure(kind) };
}

/** A post that answers from `outcomes` in order, then succeeds. */
function scriptedPost(outcomes: OutboundPostResult[]) {
  const posted: string[] = [];
  const post: PostFn = async (params) => {
    posted.push(params.text);
    return outcomes.shift() ?? { ok: true, externalMessageId: `ts-${posted.length}` };
  };
  return { post, posted };
}

async function answer(engine: RelayEngine, turnId: string, text: string): Promise<void> {
  await engine.onStream(AGENT_ID, {
    kind: "timeline",
    turnId,
    item: { type: "assistant_message", messageId: `${turnId}-m`, text },
  });
  await engine.onStream(AGENT_ID, { kind: "turn_completed", turnId });
}

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;

async function openStore(): Promise<void> {
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  store = new ChannelStore(bundle.runtime);
}

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-final-retry-db-"));
  await openStore();
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ($1, 'Retry Org', 'retry-org')`,
    [ORGANIZATION_ID],
  );
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

function engineFor(post: PostFn, clock: ManualClock, ctx: StreamContext): RelayEngine {
  const engine = new RelayEngine({
    organizationId: ORGANIZATION_ID,
    logger: SILENT,
    clock,
    store,
    post,
  });
  engine.attach(ctx);
  return engine;
}

function retrierFor(post: PostFn, clock: ManualClock, accountId: string): FinalAnswerRetrier {
  return new FinalAnswerRetrier({
    store,
    scope: { organizationId: ORGANIZATION_ID, channel: "slack", accountId },
    post,
    logger: SILENT,
    abortSignal: new AbortController().signal,
    now: () => clock.now(),
  });
}

async function ledgerRow(accountId: string, turnId: string) {
  const record = await store.findDeliveryLedgerRecord(
    ORGANIZATION_ID,
    accountId,
    "out",
    "C1",
    "1.0",
    `${AGENT_ID}:${turnId}`,
    0,
  );
  assert.ok(record, "the answer's ledger row exists");
  return record;
}

async function outboundFailures(accountId: string) {
  const result = await bundle.runtime.query<{ evidence: Record<string, unknown> }>(
    `select evidence from audit_events
       where organization_id = $1 and action = 'channel.outbound.failed' and subject_id = $2`,
    [ORGANIZATION_ID, `slack/${accountId}`],
  );
  return result.rows.map((row) => row.evidence);
}

describe("final answer retry", () => {
  it("retries a failed final answer after its backoff and posts it exactly once", async () => {
    const clock = new ManualClock(START);
    const ctx = context("backoff");
    const first = scriptedPost([failed("unavailable")]);
    await answer(engineFor(first.post, clock, ctx), "turn-1", "the answer");
    const row = await ledgerRow("backoff", "turn-1");
    assert.equal(row.status, "failed");
    assert.equal(row.nextAttemptAt?.getTime(), START + finalAnswerRetryDelayMs(1));

    const retry = scriptedPost([]);
    const retrier = retrierFor(retry.post, clock, "backoff");
    assert.equal(await retrier.runDue(), 0, "nothing is due before the backoff ends");
    clock.advance(finalAnswerRetryDelayMs(1));
    assert.equal(await retrier.runDue(), 1);
    assert.deepEqual(retry.posted, ["the answer"]);
    const posted = await ledgerRow("backoff", "turn-1");
    assert.equal(posted.status, "posted");
    assert.equal(posted.attempts, 2);
    assert.equal(posted.nextAttemptAt, null);

    // Neither another pass nor a replayed stream posts it again.
    clock.advance(finalAnswerRetryDelayMs(4));
    assert.equal(await retrier.runDue(), 0);
    await answer(engineFor(retry.post, clock, ctx), "turn-1", "the answer");
    assert.deepEqual(retry.posted, ["the answer"]);
  });

  it("resumes a scheduled retry after the store is reopened", async () => {
    const clock = new ManualClock(START);
    const first = scriptedPost([failed("rate_limited")]);
    await answer(engineFor(first.post, clock, context("restart")), "turn-r", "survives");
    await bundle.runtime.close();
    await openStore();

    clock.advance(finalAnswerRetryDelayMs(1));
    const retry = scriptedPost([]);
    assert.equal(await retrierFor(retry.post, clock, "restart").runDue(), 1);
    assert.deepEqual(retry.posted, ["survives"]);
    assert.equal((await ledgerRow("restart", "turn-r")).status, "posted");
  });

  it("gives up at the attempt cap and records the lost answer in Activity", async () => {
    const clock = new ManualClock(START);
    const always = Array.from({ length: MAX_FINAL_ANSWER_ATTEMPTS }, () => failed("unavailable"));
    const script = scriptedPost(always);
    await answer(engineFor(script.post, clock, context("capped")), "turn-c", "never lands");
    const retrier = retrierFor(script.post, clock, "capped");
    for (let attempt = 1; attempt < MAX_FINAL_ANSWER_ATTEMPTS; attempt += 1) {
      clock.advance(finalAnswerRetryDelayMs(attempt));
      assert.equal(await retrier.runDue(), 1, `attempt ${attempt + 1} runs when due`);
    }
    assert.equal(script.posted.length, MAX_FINAL_ANSWER_ATTEMPTS);
    clock.advance(finalAnswerRetryDelayMs(MAX_FINAL_ANSWER_ATTEMPTS));
    assert.equal(await retrier.runDue(), 0, "nothing is scheduled past the cap");

    const row = await ledgerRow("capped", "turn-c");
    assert.equal(row.status, "failed");
    assert.equal(row.attempts, MAX_FINAL_ANSWER_ATTEMPTS);
    assert.equal(row.nextAttemptAt, null);
    const [activity] = await outboundFailures("capped");
    assert.equal(activity?.["outcome"], "error");
    assert.match(String(activity?.["outcomeDetail"]), /not posted after 5 attempts/);
    assert.equal(activity?.["conversationId"], "C1");
  });

  it("never re-posts an answer whose write may have landed", async () => {
    const clock = new ManualClock(START);
    const script = scriptedPost([failed("timeout")]);
    await answer(engineFor(script.post, clock, context("timeout")), "turn-t", "maybe posted");
    clock.advance(finalAnswerRetryDelayMs(4));
    assert.equal(await retrierFor(script.post, clock, "timeout").runDue(), 0);
    assert.equal((await ledgerRow("timeout", "turn-t")).nextAttemptAt, null);
    const [activity] = await outboundFailures("timeout");
    assert.match(String(activity?.["outcomeDetail"]), /may not have been posted/);
  });

  it("never re-posts a post that may have landed when the stream replays", async () => {
    const clock = new ManualClock(START);
    const ctx = context("replay-uncertain", { toolActivity: true });
    for (const kind of ["timeout", "partially_posted", "server_error"] as const) {
      const turnId = `turn-${kind}`;
      const first = scriptedPost([failed(kind)]);
      await answer(engineFor(first.post, clock, ctx), turnId, `answer ${kind}`);
      const replay = scriptedPost([]);
      await answer(engineFor(replay.post, clock, ctx), turnId, `answer ${kind}`);
      assert.deepEqual(replay.posted, [], `${kind}: the replay posts nothing`);
      const row = await ledgerRow("replay-uncertain", turnId);
      assert.equal(row.status, "recorded");
      assert.match(row.failureReason ?? "", new RegExp(kind));
    }
    // A tool line that may have landed is not re-posted on replay either.
    const running = { type: "tool_call" as const, name: "shell", status: "running" };
    const first = scriptedPost([failed("timeout")]);
    await engineFor(first.post, clock, ctx).onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-progress-uncertain",
      item: running,
    });
    const replay = scriptedPost([]);
    await engineFor(replay.post, clock, ctx).onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-progress-uncertain",
      item: running,
    });
    assert.deepEqual(replay.posted, []);
  });

  it("does not retry a refusal that sending again cannot change", async () => {
    const clock = new ManualClock(START);
    const script = scriptedPost([failed("channel_not_found")]);
    await answer(engineFor(script.post, clock, context("refused")), "turn-n", "nowhere to go");
    assert.equal((await ledgerRow("refused", "turn-n")).nextAttemptAt, null);
    assert.equal((await outboundFailures("refused")).length, 1);
  });

  it("waits for the attempt in flight when it stops", async () => {
    const clock = new ManualClock(START);
    const first = scriptedPost([failed("unavailable")]);
    await answer(engineFor(first.post, clock, context("stopping")), "turn-s", "in flight");
    clock.advance(finalAnswerRetryDelayMs(1));
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const attemptStarted = new Promise<void>((resolve) => (started = resolve));
    const held: PostFn = async () => {
      started();
      await new Promise<void>((resolve) => (release = resolve));
      return { ok: true, externalMessageId: "ts-held" };
    };
    const retrier = retrierFor(held, clock, "stopping");
    retrier.start();
    await attemptStarted;
    const stopping = retrier.stop();
    const early = await Promise.race([
      stopping.then(() => "stopped"),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 10)),
    ]);
    assert.equal(early, "waiting", "stop waits for the attempt in flight");
    release();
    await stopping;
    assert.equal((await ledgerRow("stopping", "turn-s")).status, "posted");
  });

  it("retries a failing ledger write, and logs an error when it never succeeds", async () => {
    const clock = new ManualClock(START);
    let failuresLeft = 1;
    class FlakyStore extends ChannelStore {
      override async recordDelivery(...args: Parameters<ChannelStore["recordDelivery"]>) {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw new Error("connection pool exhausted");
        }
        return await super.recordDelivery(...args);
      }
    }
    const flaky = new FlakyStore(bundle.runtime);
    const errors: unknown[] = [];
    const logger: PlaneLogger = { warn: () => undefined, error: (_m, meta) => errors.push(meta) };
    const script = scriptedPost([]);
    const engineWith = (ctx: StreamContext) => {
      const engine = new RelayEngine({
        organizationId: ORGANIZATION_ID,
        logger,
        clock,
        store: flaky,
        post: script.post,
      });
      engine.attach(ctx);
      return engine;
    };
    await answer(engineWith(context("ledger-flaky")), "turn-l1", "survives one fault");
    assert.deepEqual(script.posted, ["survives one fault"]);
    assert.equal(errors.length, 0);

    failuresLeft = 10;
    await answer(engineWith(context("ledger-flaky")), "turn-l2", "cannot be recorded");
    assert.deepEqual(script.posted, ["survives one fault"], "no post without a ledger row");
    assert.match(JSON.stringify(errors), /"step":"record".*not posted/);
  });

  it("says so as an error when a retried ledger record finds its own row", async () => {
    const clock = new ManualClock(START);
    let lostReplies = 1;
    // The first insert commits, but its reply is lost on the way back.
    class LostReplyStore extends ChannelStore {
      override async recordDelivery(...args: Parameters<ChannelStore["recordDelivery"]>) {
        const recorded = await super.recordDelivery(...args);
        if (lostReplies > 0) {
          lostReplies -= 1;
          throw new Error("connection reset after commit");
        }
        return recorded;
      }
    }
    const errors: unknown[] = [];
    const script = scriptedPost([]);
    const engine = new RelayEngine({
      organizationId: ORGANIZATION_ID,
      logger: { warn: () => undefined, error: (_m, meta) => errors.push(meta) },
      clock,
      store: new LostReplyStore(bundle.runtime),
      post: script.post,
    });
    engine.attach(context("lost-reply"));
    await answer(engine, "turn-lost", "reply lost after commit");
    assert.deepEqual(script.posted, [], "no double-post risk is taken");
    assert.match(JSON.stringify(errors), /may have committed/);
  });

  it("does not retry a failed tool line", async () => {
    const clock = new ManualClock(START);
    const script = scriptedPost([failed("unavailable")]);
    const engine = engineFor(script.post, clock, context("progress", { toolActivity: true }));
    await engine.onStream(AGENT_ID, {
      kind: "timeline",
      turnId: "turn-p",
      item: { type: "tool_call", name: "shell", status: "running" },
    });
    assert.deepEqual(script.posted, ["Running shell…"]);
    const row = await ledgerRow("progress", "turn-p");
    assert.equal(row.status, "failed");
    assert.equal(row.nextAttemptAt, null);
    assert.equal((await outboundFailures("progress")).length, 0);
  });
});
