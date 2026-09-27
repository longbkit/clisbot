import { createDeferredCore } from "@getpaseo/channels-core/shared/deferred";
// Targeted tests for the durable ingress drain on its production path: the
// real `ChannelStore` over a migrated embedded (PGlite) database, the real
// queue-sink adapter, and the retry policy ported verbatim from OpenClaw
// (`@getpaseo/channels-core/channels/message/ingress-retry-policy`). Nothing
// here fakes the queue — a fake would prove the loop and not the claim lease,
// the lane lock or the fencing token, which are the parts a restart depends on.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { InboundLedgerSink, InboundQueueSink } from "@getpaseo/channels-shared";
import { ChannelDeliveryRecordNotFoundError, ChannelStore } from "../../db/channels.js";
import type { ChannelIngressQueueRecord } from "../../db/types.js";
import { embeddedDatabaseRuntime } from "../../db/runtime/index.js";
import type { DatabaseRuntimeBundle } from "../../db/runtime/index.js";
import {
  accountDrainConcurrency,
  createChannelIngressDrain,
  type ChannelIngressDrain,
  type ChannelIngressDrainOptions,
} from "./drain.js";
import { resolveHubIngressNonRetryableFailure } from "./non-retryable.js";
import { dispatchQueuedInbound } from "./dispatch.js";
import type { InboundReplyResult } from "../loader/host.js";
import { sessionLaneKey } from "./session-lane.js";
import type { CompiledChannelAccount } from "../config/compile.js";
import type { InboundMessage } from "../plane/types.js";
import { AgentRequestRefusedError } from "../daemon/agent-request-refusal.js";
import {
  createChannelIngressQueueSink,
  type ChannelIngressQueueSinkOptions,
} from "./queue-sink.js";

const ORGANIZATION_ID = "drain-org";
const CHANNEL = "telegram";

let dataDirectory: string;
let bundle: DatabaseRuntimeBundle;
let store: ChannelStore;

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "hub-ingress-drain-"));
  bundle = await embeddedDatabaseRuntime(dataDirectory);
  await bundle.runtime.migrate();
  await bundle.runtime.query(
    `insert into organization (id, name, slug) values ($1, 'Drain Org', 'drain-org')`,
    [ORGANIZATION_ID],
  );
  store = new ChannelStore(bundle.runtime);
}, 60_000);

afterAll(async () => {
  await bundle.runtime.close();
  await rm(dataDirectory, { recursive: true, force: true });
});

function sinkFor(
  accountId: string,
  options: Partial<ChannelIngressQueueSinkOptions> = {},
): InboundQueueSink {
  return createChannelIngressQueueSink({
    store,
    organizationId: ORGANIZATION_ID,
    channel: CHANNEL,
    accountId,
    ...options,
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function admit(
  accountId: string,
  eventId: string,
  laneKey = `lane-${accountId}`,
): Promise<void> {
  await sinkFor(accountId).enqueue({
    channel: CHANNEL,
    accountId,
    externalEventId: eventId,
    externalMessageId: eventId,
    externalConversationId: `conversation-${accountId}`,
    laneKey,
    payload: { event: eventId },
  });
  // Arrival order is `(created_at, id)` and the id is random: rows stamped in
  // the same instant have no order for a test to assert.
  await sleep(3);
}

async function readEvent(accountId: string, eventId: string): Promise<ChannelIngressQueueRecord> {
  const rows = await store.listChannelIngress({ organizationId: ORGANIZATION_ID, accountId });
  const row = rows.find((entry) => entry.externalEventId === eventId);
  assert.ok(row, `no ingress row for ${eventId}`);
  return row;
}

function drainFor(
  accountId: string,
  overrides: Partial<ChannelIngressDrainOptions> & {
    dispatch: ChannelIngressDrainOptions["dispatch"];
  },
) {
  return createChannelIngressDrain({
    queue: sinkFor(accountId),
    organizationId: ORGANIZATION_ID,
    channel: CHANNEL,
    accountId,
    workerId: `${CHANNEL}:${accountId}:drain`,
    abortSignal: new AbortController().signal,
    resolveNonRetryableFailure: resolveHubIngressNonRetryableFailure,
    ...overrides,
  });
}

function ledgerFor(accountId: string): InboundLedgerSink {
  return {
    record: async (input) => {
      const { created } = await store.recordInbound({
        ...input,
        channel: CHANNEL,
        accountId,
        organizationId: ORGANIZATION_ID,
      });
      return { created };
    },
    consume: async (input) => {
      await store.consumeInbound({
        ...input,
        accountId,
        organizationId: ORGANIZATION_ID,
        consumedAt: new Date(),
      });
    },
  };
}

async function admitCommand(accountId: string, command: string): Promise<void> {
  await sinkFor(accountId).enqueue({
    channel: CHANNEL,
    accountId,
    externalEventId: command,
    externalMessageId: command,
    externalConversationId: accountId,
    laneKey: accountId,
    payload: {
      channel: CHANNEL,
      accountId,
      ctxPayload: { ChatId: accountId, MessageSid: command, Body: `/${command}` },
    },
  });
  await sleep(3);
}

describe("channel ingress drain", () => {
  it("does not dispatch after a timed-out audit write eventually returns", async () => {
    const accountId = "late-audit";
    await admitCommand(accountId, "status");
    const recordGate = createDeferredCore<void>();
    const finished = createDeferredCore<void>();
    let replies = 0;
    const ledger = ledgerFor(accountId);
    const drain = drainFor(accountId, {
      dispatchTimeoutMs: 20,
      dispatch: async (payload, claim) => {
        try {
          return await dispatchQueuedInbound({
            channel: CHANNEL,
            accountId,
            payload,
            ingressId: claim.id,
            logger: { warn: () => undefined },
            hostRuntime: {
              inboundLedger: {
                ...ledger,
                record: async (input) => {
                  await recordGate.promise;
                  return ledger.record(input);
                },
              },
              onInboundReply: async () => {
                replies += 1;
                return { dispatched: true };
              },
            },
          });
        } finally {
          finished.resolve();
        }
      },
    });
    try {
      const pass = await drain.drainOnce();
      assert.equal(pass.deadLettered, 1);
      assert.equal(pass.retried, 0);
      recordGate.resolve();
      await finished.promise;
      assert.equal(replies, 0);
      assert.equal((await readEvent(accountId, "status")).status, "dead_letter");
    } finally {
      recordGate.resolve();
      await drain.stop();
    }
  });

  it("ends a hung dispatch on account abort without replaying or claiming the next event", async () => {
    const accountId = "aborted-dispatch";
    await admit(accountId, "hung");
    await admit(accountId, "next");
    const account = new AbortController();
    const started = createDeferredCore<void>();
    const late = createDeferredCore<void>();
    const drain = drainFor(accountId, {
      abortSignal: account.signal,
      concurrency: 1,
      dispatch: async () => {
        started.resolve();
        await late.promise;
      },
    });
    const pending = drain.drainOnce();
    try {
      await started.promise;
      account.abort();
      const pass = await pending;
      assert.equal(pass.claimed, 1);
      assert.equal(pass.deadLettered, 1);
      assert.equal(pass.retried, 0);
      assert.equal((await readEvent(accountId, "next")).status, "pending");
    } finally {
      late.resolve();
      await pending;
      await drain.stop();
    }
  });

  it("caps a long deferral at the event's age budget", async () => {
    const accountId = "bounded-deferral";
    await admit(accountId, "waiting");
    const event = await readEvent(accountId, "waiting");
    const expiresAt = event.createdAt.getTime() + 10 * 60_000;
    let now = event.createdAt.getTime() + 9 * 60_000;
    let calls = 0;
    const drain = drainFor(accountId, {
      now: () => now,
      dispatch: async () => {
        calls += 1;
        return { kind: "deferred", reason: "host away", retryAfterMs: 24 * 60 * 60_000 };
      },
    });
    assert.equal((await drain.drainOnce()).deferred, 1);
    assert.equal((await readEvent(accountId, "waiting")).availableAt.getTime(), expiresAt);
    // The real store uses wall time for claims; make the row due as that time elapses.
    await bundle.runtime.query(
      "update channel_ingress_queue set available_at = now() where id = $1",
      [event.id],
    );
    now = expiresAt;
    assert.equal((await drain.drainOnce()).deadLettered, 1);
    assert.equal(calls, 1);
  });

  it("ends a hung dispatch without replay, frees its lane and ignores a late completion", async () => {
    const accountId = "dispatch-deadline";
    await admit(accountId, "hung");
    await admit(accountId, "next");
    const hung = await readEvent(accountId, "hung");
    const late = createDeferredCore<void>();
    const dispatched: string[] = [];
    const signals: AbortSignal[] = [];
    const drain = drainFor(accountId, {
      dispatchTimeoutMs: 20,
      concurrency: 1,
      dispatch: async (_payload, claim, signal) => {
        dispatched.push(claim.id);
        signals.push(signal);
        if (claim.id === hung.id) await late.promise;
      },
    });
    const passPromise = drain.drainOnce();
    try {
      const pass = await Promise.race([
        passPromise,
        sleep(1_000).then(() => {
          throw new Error("dispatch deadline did not end the wait");
        }),
      ]);
      assert.equal(pass.deadLettered, 1);
      assert.equal(pass.retried, 0);
      assert.equal(pass.completed, 1);
      assert.equal(signals[0]?.aborted, true);
      assert.equal((await readEvent(accountId, "hung")).failedReason, "dispatch-outcome-unknown");
      late.resolve();
      await late.promise;
      assert.equal((await drain.drainOnce()).claimed, 0);
      assert.equal((await readEvent(accountId, "hung")).status, "dead_letter");
      assert.deepEqual(dispatched, [hung.id, (await readEvent(accountId, "next")).id]);
    } finally {
      late.resolve();
      await passPromise;
      await drain.stop();
    }
  });

  it("ends an exhausted recovered claim before dispatch and frees the lane", async () => {
    const accountId = "recovery-budget";
    await admit(accountId, "poison");
    await admit(accountId, "next");
    const claim = await sinkFor(accountId).claim({
      organizationId: ORGANIZATION_ID,
      channel: CHANNEL,
      accountId,
      workerId: "dead-worker",
      leaseMs: 30_000,
    });
    assert.ok(claim);
    await bundle.runtime.query(
      "update channel_ingress_queue set attempts = 8, lease_expires_at = now() - interval '1 second' where id = $1",
      [claim.id],
    );
    const delivered: string[] = [];
    const drain = drainFor(accountId, {
      dispatch: async (_payload, current) => {
        delivered.push(current.id);
      },
    });
    const pass = await drain.drainOnce();
    assert.equal(pass.deadLettered, 1);
    assert.equal(pass.completed, 1);
    assert.deepEqual(delivered, [(await readEvent(accountId, "next")).id]);
    assert.equal((await readEvent(accountId, "poison")).failedReason, "retry-limit-exceeded");
  });

  it("expires an old queued event before dispatch but honors an explicit resubmission", async () => {
    const accountId = "age-budget";
    await admit(accountId, "old");
    const row = await readEvent(accountId, "old");
    await bundle.runtime.query(
      "update channel_ingress_queue set created_at = now() - interval '11 minutes' where id = $1",
      [row.id],
    );
    const delivered: string[] = [];
    const drain = drainFor(accountId, {
      dispatch: async (_payload, current) => {
        delivered.push(current.id);
      },
    });
    assert.equal((await drain.drainOnce()).deadLettered, 1);
    assert.deepEqual(delivered, []);
    assert.equal((await readEvent(accountId, "old")).failedReason, "ingress-age-exceeded");
    await store.resubmitChannelIngress({ organizationId: ORGANIZATION_ID, ids: [row.id] });
    assert.equal((await drain.drainOnce()).completed, 1);
    assert.deepEqual(delivered, [row.id]);
  });

  it.each([
    {
      accountId: "audit-declined",
      result: { dispatched: false },
      status: "completed",
      attempts: 1,
    },
    {
      accountId: "audit-deferred",
      result: { dispatched: false, deferred: { reason: "route busy", retryAfterMs: 5_000 } },
      status: "pending",
      attempts: 0,
    },
  ])(
    "does not consume an audit for $accountId",
    async ({ accountId, result, status, attempts }) => {
      await admitCommand(accountId, "status");
      const drain = drainFor(accountId, {
        now: () => Date.now() + 60_000,
        dispatch: (payload, claim) =>
          dispatchQueuedInbound({
            channel: CHANNEL,
            accountId,
            payload,
            ingressId: claim.id,
            logger: { warn: () => assert.fail("unexpected audit failure") },
            hostRuntime: {
              inboundLedger: ledgerFor(accountId),
              onInboundReply: async (): Promise<InboundReplyResult> => result,
            },
          }),
      });
      const pass = await drain.drainOnce();
      assert.equal(pass.claimed, 1);
      assert.equal(pass.retried, 0);
      const row = await readEvent(accountId, "status");
      assert.equal(row.status, status);
      assert.equal(row.attempts, attempts);
      const audit = await bundle.runtime.query(
        "select status from delivery_ledger where account_id = $1",
        [accountId],
      );
      assert.deepEqual(audit.rows, [{ status: "recorded" }]);
    },
  );

  it("dispatches events without a native message id without inventing a ledger identity", async () => {
    const accountId = "no-native-message-id";
    const delivered: unknown[] = [];
    await dispatchQueuedInbound({
      channel: CHANNEL,
      accountId,
      ingressId: "durable-operation-id",
      payload: { channel: CHANNEL, accountId, ctxPayload: { ChatId: "conversation" } },
      logger: { warn: () => assert.fail("unexpected audit failure") },
      hostRuntime: {
        inboundLedger: {
          record: async () => assert.fail("no native identity to record"),
          consume: async () => assert.fail("no native identity to consume"),
        },
        onInboundReply: async (params) => {
          delivered.push(params.ctxPayload?.["ClisbotInboundOperationId"]);
          return { dispatched: true };
        },
      },
    });
    assert.deepEqual(delivered, ["durable-operation-id"]);
  });

  it.each([
    { accountId: "audit-missing-after-dispatch", error: new ChannelDeliveryRecordNotFoundError() },
    { accountId: "audit-unavailable-after-dispatch", error: new Error("audit write unavailable") },
  ])(
    "completes delivered commands and frees the lane when $accountId",
    async ({ accountId, error }) => {
      await admitCommand(accountId, "status");
      await admitCommand(accountId, "stop");
      const delivered: unknown[] = [];
      const warnings: unknown[] = [];
      const drain = drainFor(accountId, {
        dispatch: (payload, claim) =>
          dispatchQueuedInbound({
            channel: CHANNEL,
            accountId,
            payload,
            ingressId: claim.id,
            logger: { warn: (message, detail) => warnings.push({ message, detail }) },
            hostRuntime: {
              inboundLedger: {
                ...ledgerFor(accountId),
                consume: async () => {
                  throw error;
                },
              },
              onInboundReply: async (params) => {
                delivered.push(params.ctxPayload?.["Body"]);
                return { dispatched: true };
              },
            },
          }),
      });
      const pass = await drain.drainOnce();
      assert.equal(pass.completed, 2);
      assert.equal(pass.retried, 0);
      assert.equal(pass.deadLettered, 0);
      assert.deepEqual(delivered, ["/status", "/stop"]);
      assert.deepEqual(
        warnings,
        await Promise.all(
          ["status", "stop"].map(async (command) => ({
            message: "channel inbound audit failed after dispatch",
            detail: {
              channel: CHANNEL,
              account: accountId,
              event: (await readEvent(accountId, command)).id,
              error: error.message,
            },
          })),
        ),
      );
      assert.equal((await drain.drainOnce()).claimed, 0);
      assert.deepEqual(delivered, ["/status", "/stop"]);
    },
  );

  it("retries an audit record failure before any command side effect", async () => {
    const accountId = "audit-unavailable-before-dispatch";
    await admitCommand(accountId, "status");
    const ledger = ledgerFor(accountId);
    let failuresRemaining = 1;
    const delivered: unknown[] = [];
    const warnings: string[] = [];
    const drain = drainFor(accountId, {
      retryPolicy: { baseMs: 0, maxMs: 0 },
      dispatch: (payload, claim) =>
        dispatchQueuedInbound({
          channel: CHANNEL,
          accountId,
          payload,
          ingressId: claim.id,
          logger: { warn: (message) => warnings.push(message) },
          hostRuntime: {
            inboundLedger: {
              ...ledger,
              record: async (input) => {
                if (failuresRemaining > 0) {
                  failuresRemaining -= 1;
                  throw new Error("audit store unavailable");
                }
                return ledger.record(input);
              },
            },
            onInboundReply: async (params) => {
              delivered.push(params.ctxPayload?.["Body"]);
              return { dispatched: true };
            },
          },
        }),
    });
    const pass = await drain.drainOnce();
    assert.equal(pass.retried, 1);
    assert.equal(pass.completed, 1);
    assert.deepEqual(delivered, ["/status"]);
    assert.deepEqual(warnings, []);
  });

  it("retries a failed dispatch against an existing audit without treating it as delivered", async () => {
    const accountId = "audit-existing-dispatch-retry";
    await admitCommand(accountId, "status");
    let failuresRemaining = 1;
    const delivered: unknown[] = [];
    const drain = drainFor(accountId, {
      retryPolicy: { baseMs: 0, maxMs: 0 },
      dispatch: (payload, claim) =>
        dispatchQueuedInbound({
          channel: CHANNEL,
          accountId,
          payload,
          ingressId: claim.id,
          logger: { warn: () => assert.fail("unexpected audit failure") },
          hostRuntime: {
            inboundLedger: ledgerFor(accountId),
            onInboundReply: async (params) => {
              if (failuresRemaining > 0) {
                failuresRemaining -= 1;
                throw new Error("host temporarily disconnected");
              }
              delivered.push(params.ctxPayload?.["Body"]);
              return { dispatched: true };
            },
          },
        }),
    });
    const pass = await drain.drainOnce();
    assert.equal(pass.retried, 1);
    assert.equal(pass.completed, 1);
    assert.deepEqual(delivered, ["/status"]);
    const audit = await bundle.runtime.query(
      "select status from delivery_ledger where account_id = $1",
      [accountId],
    );
    assert.deepEqual(audit.rows, [{ status: "consumed" }]);
  });

  it("exhausts eight failed attempts on a fresh event and releases the next command", async () => {
    const accountId = "fresh-retry-ceiling";
    await admit(accountId, "poison");
    await admit(accountId, "stop");
    const delivered: string[] = [];
    const drain = drainFor(accountId, {
      // Keep the production attempt/age budget; only remove the wait between tries.
      retryPolicy: { baseMs: 0, maxMs: 0 },
      dispatch: async (_payload, claim) => {
        const row = await readEvent(accountId, "poison");
        if (claim.id === row.id) throw new Error("handoff failed");
        delivered.push("stop");
      },
    });
    const pass = await drain.drainOnce();
    assert.equal(pass.retried, 7);
    assert.equal(pass.deadLettered, 1);
    assert.equal(pass.completed, 1);
    const row = await readEvent(accountId, "poison");
    assert.equal(row.attempts, 8);
    assert.equal(row.failedReason, "retry-limit-exceeded");
    assert.deepEqual(delivered, ["stop"]);
  });

  it("dead-letters a missing delivery record on the first attempt and frees its lane", async () => {
    const accountId = "missing-delivery-record";
    await admit(accountId, "poison");
    await admit(accountId, "stop");
    const poison = await readEvent(accountId, "poison");
    const drain = drainFor(accountId, {
      now: () => Date.now() + 60_000,
      dispatch: async (_payload, claim) => {
        if (claim.id === poison.id) throw new ChannelDeliveryRecordNotFoundError();
      },
    });
    const pass = await drain.drainOnce();
    assert.equal(pass.deadLettered, 1);
    assert.equal(pass.retried, 0);
    assert.equal(pass.completed, 1);
    assert.equal((await readEvent(accountId, "poison")).attempts, 1);
    assert.equal((await readEvent(accountId, "poison")).failedReason, "delivery-record-not-found");
  });

  it("repairs a missing inbound audit before dispatch and completes without replay", async () => {
    const accountId = "missing-inbound-audit";
    const messageId = "status-1";
    const conversationId = "incident-thread";
    const ledger = ledgerFor(accountId);
    await sinkFor(accountId).enqueue({
      channel: CHANNEL,
      accountId,
      externalEventId: messageId,
      externalMessageId: messageId,
      externalConversationId: conversationId,
      laneKey: "incident-thread",
      payload: {
        channel: CHANNEL,
        accountId,
        ctxPayload: {
          ChatId: conversationId,
          MessageSid: messageId,
          Body: "/status",
          SenderId: "incident-sender",
        },
      },
    });
    const delivered: string[] = [];
    const warnings: string[] = [];
    const drain = drainFor(accountId, {
      now: () => Date.now() + 60_000,
      dispatch: (payload, claim) =>
        dispatchQueuedInbound({
          channel: CHANNEL,
          accountId,
          payload,
          ingressId: claim.id,
          logger: { warn: (message) => warnings.push(message) },
          hostRuntime: {
            inboundLedger: {
              ...ledger,
              record: (input) => {
                assert.equal(input.senderIdentity, "incident-sender");
                return ledger.record(input);
              },
            },
            onInboundReply: async () => {
              const audit = await bundle.runtime.query(
                "select status from delivery_ledger where account_id = $1 and external_message_id = $2",
                [accountId, messageId],
              );
              assert.deepEqual(audit.rows, [{ status: "recorded" }]);
              delivered.push(messageId);
              return { dispatched: true };
            },
          },
        }),
    });

    const pass = await drain.drainOnce();
    assert.equal(pass.completed, 1);
    assert.equal(pass.retried, 0);
    assert.equal((await readEvent(accountId, messageId)).status, "completed");
    assert.equal((await drain.drainOnce()).claimed, 0);
    assert.deepEqual(delivered, [messageId]);
    assert.deepEqual(warnings, []);
    const audit = await bundle.runtime.query(
      "select status, turn_id from delivery_ledger where account_id = $1 and external_message_id = $2",
      [accountId, messageId],
    );
    assert.deepEqual(audit.rows, [{ status: "consumed", turn_id: `${CHANNEL}:${messageId}` }]);
  });

  it("schedules the upstream backoff delay for a retryable failure", async () => {
    const accountId = "backoff";
    await admit(accountId, "event-backoff");
    // A minute out: a backoff that lands in the past would make the row due
    // again inside the same pass, and the assertion below would count the
    // batch instead of the one retry it is about.
    const now = Date.now() + 60_000;
    const retries: Array<{ retryAt: Date; message: string }> = [];
    const drain = drainFor(accountId, {
      dispatch: () => Promise.reject(new Error("daemon client is not connected")),
      now: () => now,
      log: { retried: (_claim, detail) => retries.push(detail) },
    });

    const pass = await drain.drainOnce();

    assert.deepEqual(pass, {
      claimed: 1,
      completed: 0,
      retried: 1,
      deadLettered: 0,
      deferred: 0,
      abandoned: 0,
    });
    // First attempt: base 1s, factor 2, no jitter (DEFAULT_INGRESS_RETRY_BASE_MS).
    assert.equal(retries[0]?.retryAt.getTime(), now + 1_000);
    assert.equal(retries[0]?.message, "daemon client is not connected");
    const row = await readEvent(accountId, "event-backoff");
    assert.equal(row.status, "failed");
    assert.equal(row.attempts, 1);
    assert.equal(row.availableAt.getTime(), now + 1_000);
    assert.equal(row.lastError, "daemon client is not connected");
    assert.equal(row.failedReason, null);
  });

  it("dead-letters once the attempt ceiling and the minimum age are both met", async () => {
    const accountId = "ceiling";
    await admit(accountId, "event-ceiling");
    const deadLetters: Array<{ reason: string; message: string }> = [];
    const drain = drainFor(accountId, {
      dispatch: () => Promise.reject(new Error("handoff refused")),
      // baseMs 0 makes each retry immediately due, so one pass walks the whole
      // budget; deadLetterMinAgeMs 0 removes upstream's 24h age floor.
      retryPolicy: { maxAttempts: 3, deadLetterMinAgeMs: 0, baseMs: 0, maxMs: 0 },
      log: { deadLettered: (_claim, detail) => deadLetters.push(detail) },
    });

    const pass = await drain.drainOnce();

    assert.equal(pass.claimed, 3);
    assert.equal(pass.retried, 2);
    assert.equal(pass.deadLettered, 1);
    assert.equal(deadLetters.length, 1);
    assert.equal(deadLetters[0]?.reason, "retry-limit-exceeded");
    assert.equal(deadLetters[0]?.message, "handoff refused");
    const row = await readEvent(accountId, "event-ceiling");
    assert.equal(row.status, "dead_letter");
    assert.equal(row.attempts, 3);
    assert.equal(row.failedReason, "retry-limit-exceeded");
    assert.ok(row.failedAt);
  });

  it("dead-letters a non-retryable failure without spending the retry budget", async () => {
    const accountId = "non-retryable";
    await admit(accountId, "event-non-retryable");
    const missingAgent = new Error('Unknown agent "worker-app"');
    missingAgent.name = "ChannelAgentSpecError";
    const drain = drainFor(accountId, { dispatch: () => Promise.reject(missingAgent) });

    const pass = await drain.drainOnce();

    assert.equal(pass.deadLettered, 1);
    assert.equal(pass.retried, 0);
    const row = await readEvent(accountId, "event-non-retryable");
    assert.equal(row.status, "dead_letter");
    assert.equal(row.attempts, 1);
    assert.equal(row.failedReason, "missing-agent-harness");
  });

  it("resubmitted dead-letters are drained again", async () => {
    const accountId = "resubmit";
    await admit(accountId, "event-resubmit");
    const failing = drainFor(accountId, {
      dispatch: () => Promise.reject(new Error("temporary")),
      retryPolicy: { maxAttempts: 1, deadLetterMinAgeMs: 0, baseMs: 0, maxMs: 0 },
    });
    await failing.drainOnce();
    const dead = await readEvent(accountId, "event-resubmit");
    assert.equal(dead.status, "dead_letter");

    await store.resubmitChannelIngress({ organizationId: ORGANIZATION_ID, ids: [dead.id] });
    const delivered: unknown[] = [];
    const healthy = drainFor(accountId, {
      dispatch: async (payload) => {
        delivered.push(payload);
      },
    });

    const pass = await healthy.drainOnce();

    assert.equal(pass.completed, 1);
    assert.deepEqual(delivered, [{ event: "event-resubmit" }]);
    assert.equal((await readEvent(accountId, "event-resubmit")).status, "completed");
  });

  it("refuses a second claim on a lane while the first lease is live", async () => {
    const accountId = "lane";
    await admit(accountId, "event-lane-1", "shared-lane");
    await admit(accountId, "event-lane-2", "shared-lane");
    const held = await store.claimChannelIngress({
      organizationId: ORGANIZATION_ID,
      workerId: "worker-holding-the-lane",
      leaseMs: 60_000,
      accountId,
    });
    assert.ok(held);
    const delivered: unknown[] = [];
    const drain = drainFor(accountId, {
      dispatch: async (payload) => {
        delivered.push(payload);
      },
    });

    const blocked = await drain.drainOnce();
    assert.deepEqual(blocked, {
      claimed: 0,
      completed: 0,
      retried: 0,
      deadLettered: 0,
      deferred: 0,
      abandoned: 0,
    });
    assert.deepEqual(delivered, []);

    await store.completeChannelIngress({
      id: held.id,
      workerId: "worker-holding-the-lane",
      claimToken: held.claimToken!,
    });
    const freed = await drain.drainOnce();
    assert.equal(freed.completed, 1);
    assert.equal(delivered.length, 1);
  });

  it("dispatches conversations in parallel and keeps one conversation in order", async () => {
    const accountId = "parallel";
    await admit(accountId, "event-a-1", "lane-a");
    await admit(accountId, "event-a-2", "lane-a");
    await admit(accountId, "event-b-1", "lane-b");
    const started: string[] = [];
    let running = 0;
    let peak = 0;
    const drain = drainFor(accountId, {
      dispatch: async (payload) => {
        started.push((payload as { event: string }).event);
        running += 1;
        peak = Math.max(peak, running);
        await sleep(40);
        running -= 1;
      },
    });

    const pass = await drain.drainOnce();
    assert.equal(pass.completed, 3);
    assert.equal(peak, 2, "the second conversation does not wait behind the first");
    assert.ok(
      started.indexOf("event-a-1") < started.indexOf("event-a-2"),
      "a lane never has two live claims, so its order holds",
    );
  });

  it("caps a busy account at its pool share while another account proceeds", async () => {
    // A pool of 4 connections: each account's drain may keep 2 busy.
    const concurrency = accountDrainConcurrency(4);
    assert.equal(concurrency, 2);
    for (const lane of ["a", "b", "c", "d"]) await admit("busy", `busy-${lane}`, `busy-${lane}`);
    await admit("quiet", "quiet-1");
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inFlight = 0;
    let peak = 0;
    const busy = drainFor("busy", {
      intervalMs: 600_000,
      concurrency,
      dispatch: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await held;
        inFlight -= 1;
      },
    });
    const quietDelivered: string[] = [];
    const quiet = drainFor("quiet", {
      intervalMs: 600_000,
      concurrency,
      dispatch: async (_payload, claim) => {
        quietDelivered.push(claim.id);
      },
    });
    busy.start();
    try {
      const busyWorkers = () => inFlight;
      for (let tick = 0; tick < 50 && busyWorkers() < concurrency; tick += 1) await sleep(5);
      quiet.start();
      const quietStatus = async () => (await readEvent("quiet", "quiet-1")).status;
      for (let tick = 0; tick < 50 && (await quietStatus()) !== "completed"; tick += 1) {
        await sleep(5);
      }
      assert.equal(await quietStatus(), "completed");
      assert.equal(quietDelivered.length, 1);
      assert.equal(peak, concurrency, "the busy account never runs past its share");
    } finally {
      release();
      await busy.stop();
      await quiet.stop();
    }
    assert.equal(accountDrainConcurrency(undefined), 12, "PGlite keeps the default");
    assert.equal(accountDrainConcurrency(30), 12);
    assert.equal(accountDrainConcurrency(1), 1);
  });

  it("keeps two accounts stuck in slow session creates from delaying a third account", async () => {
    // Default pool: each account runs its full share of 12 workers. A daemon
    // wait holds no database connection, so 24 stuck dispatches on two accounts
    // must not hold up another account's follow-up.
    const concurrency = accountDrainConcurrency(30);
    for (const accountId of ["creating-1", "creating-2"]) {
      for (let index = 0; index < concurrency; index += 1) {
        await admit(accountId, `${accountId}-${index}`, `${accountId}-lane-${index}`);
      }
    }
    await admit("follow-up", "follow-up-1");
    let release: () => void = () => undefined;
    const creates = new Promise<void>((resolve) => {
      release = resolve;
    });
    let stuck = 0;
    const slowCreate = async () => {
      stuck += 1;
      await creates;
    };
    const creating = ["creating-1", "creating-2"].map((accountId) =>
      drainFor(accountId, { intervalMs: 600_000, concurrency, dispatch: slowCreate }),
    );
    const followUp = drainFor("follow-up", {
      intervalMs: 600_000,
      concurrency,
      dispatch: async () => undefined,
    });
    for (const drain of creating) drain.start();
    try {
      const stuckNow = () => stuck;
      for (let tick = 0; tick < 100 && stuckNow() < 2 * concurrency; tick += 1) await sleep(5);
      assert.equal(stuck, 2 * concurrency);
      followUp.start();
      const status = async () => (await readEvent("follow-up", "follow-up-1")).status;
      for (let tick = 0; tick < 50 && (await status()) !== "completed"; tick += 1) await sleep(5);
      assert.equal(await status(), "completed");
    } finally {
      release();
      await Promise.all([...creating, followUp].map((drain) => drain.stop()));
    }
  });

  it("claims a new conversation while another one's dispatch is still running", async () => {
    // The pool must not wait for its slowest dispatch before it claims again:
    // one Host RPC waiting out its timeout would otherwise hold every other
    // conversation of the account behind it.
    const accountId = "slow-lane";
    await admit(accountId, "event-slow", "lane-slow");
    let releaseSlow: () => void = () => undefined;
    const slowHeld = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const delivered: string[] = [];
    const drain = drainFor(accountId, {
      intervalMs: 600_000,
      dispatch: async (payload) => {
        const event = (payload as { event: string }).event;
        delivered.push(event);
        if (event === "event-slow") await slowHeld;
      },
    });
    drain.start();
    try {
      for (let tick = 0; tick < 50 && delivered.length === 0; tick += 1) await sleep(5);
      assert.deepEqual(delivered, ["event-slow"]);

      await admit(accountId, "event-fast", "lane-fast");
      drain.requestDrain();
      for (let tick = 0; tick < 50 && delivered.length < 2; tick += 1) await sleep(5);

      assert.deepEqual(delivered, ["event-slow", "event-fast"]);
      assert.equal((await readEvent(accountId, "event-fast")).status, "completed");
      assert.equal((await readEvent(accountId, "event-slow")).status, "claimed");
    } finally {
      releaseSlow();
      await drain.stop();
    }
    assert.equal((await readEvent(accountId, "event-slow")).status, "completed");
  });

  it("dead-letters a message the daemon holds a receipt for, and frees its lane", async () => {
    const accountId = "receipt-refused";
    await admit(accountId, "event-refused", "lane-refused");
    await admit(accountId, "event-behind", "lane-refused");
    const delivered: string[] = [];
    const drain = drainFor(accountId, {
      dispatch: async (payload) => {
        const event = (payload as { event: string }).event;
        delivered.push(event);
        if (event === "event-refused") {
          throw new AgentRequestRefusedError("agent_request_outcome_unknown");
        }
      },
    });

    const pass = await drain.drainOnce();

    assert.equal(pass.deadLettered, 1);
    assert.equal(pass.retried, 0);
    const refused = await readEvent(accountId, "event-refused");
    assert.equal(refused.status, "dead_letter");
    assert.equal(refused.failedReason, "agent-request-refused");
    assert.equal(refused.lastError, "agent_request_outcome_unknown");
    assert.deepEqual(delivered, ["event-refused", "event-behind"], "the lane moved on");
  });

  it("reports a dead-letter once, whichever rule ended the row", async () => {
    const accountId = "dead-letter-report";
    await admit(accountId, "event-refused-report", "lane-report-1");
    await admit(accountId, "event-deferred-report", "lane-report-2");
    const reported: string[] = [];
    const queue = sinkFor(accountId, {
      releaseBudget: { maxReleases: 1, pendingTtlMs: 24 * 60 * 60 * 1_000 },
      onDeadLettered: (record) => reported.push(record.externalEventId),
    });
    const drain = createChannelIngressDrain({
      queue,
      organizationId: ORGANIZATION_ID,
      channel: CHANNEL,
      accountId,
      workerId: `${CHANNEL}:${accountId}:drain`,
      abortSignal: new AbortController().signal,
      resolveNonRetryableFailure: resolveHubIngressNonRetryableFailure,
      dispatch: async (payload) => {
        if ((payload as { event: string }).event === "event-refused-report") {
          throw new AgentRequestRefusedError("agent_request_key_conflict");
        }
        return { kind: "deferred" as const, reason: "busy", retryAfterMs: 0 };
      },
    });

    await drain.drainOnce();
    await drain.drainOnce();

    assert.deepEqual(reported.sort(), ["event-deferred-report", "event-refused-report"]);
  });

  it("admits under the session lane when one is known, and the transport's otherwise", async () => {
    const accountId = "session-lane";
    const enqueue = (laneOf: () => string | undefined, eventId: string) =>
      sinkFor(accountId, { sessionLaneKey: laneOf }).enqueue({
        channel: CHANNEL,
        accountId,
        externalEventId: eventId,
        externalMessageId: eventId,
        externalConversationId: "conversation",
        laneKey: "transport-lane",
        payload: { event: eventId },
      });
    await enqueue(() => "session-lane", "event-session");
    await enqueue(() => undefined, "event-unsettled");
    await enqueue(() => {
      throw new Error("routes unreadable");
    }, "event-faulted");

    assert.equal((await readEvent(accountId, "event-session")).laneKey, "session-lane");
    assert.equal((await readEvent(accountId, "event-unsettled")).laneKey, "transport-lane");
    assert.equal((await readEvent(accountId, "event-faulted")).laneKey, "transport-lane");
  });

  it("wakes for a handed-back event when it comes due, ahead of the interval", async () => {
    const accountId = "due-wake";
    await admit(accountId, "event-due-1");
    let attempts = 0;
    const drain = drainFor(accountId, {
      intervalMs: 60_000,
      dispatch: async () => {
        attempts += 1;
        return attempts === 1
          ? { kind: "deferred", reason: "route busy", retryAfterMs: 50 }
          : undefined;
      },
    });
    drain.start();
    try {
      await sleep(400);
      assert.equal(attempts, 2);
      assert.equal((await readEvent(accountId, "event-due-1")).status, "completed");
    } finally {
      await drain.stop();
    }
  });

  it("recovers a dead worker's claim and delivers the event exactly once", async () => {
    const accountId = "crash";
    await admit(accountId, "event-crash");
    // Process death: a claim taken with a lease that expires and is never
    // completed or failed. Nothing else marks the row.
    const orphan = await store.claimChannelIngress({
      organizationId: ORGANIZATION_ID,
      workerId: "worker-that-died",
      leaseMs: 1,
      accountId,
    });
    assert.ok(orphan);
    await sleep(20);

    const delivered: unknown[] = [];
    const successor = drainFor(accountId, {
      dispatch: async (payload) => {
        delivered.push(payload);
      },
    });
    const recovered = await successor.drainOnce();
    // A second pass proves the completed tombstone, not just the first claim.
    const replay = await successor.drainOnce();

    assert.equal(recovered.completed, 1);
    assert.equal(replay.claimed, 0);
    assert.deepEqual(delivered, [{ event: "event-crash" }]);
    const row = await readEvent(accountId, "event-crash");
    assert.equal(row.status, "completed");
    assert.equal(row.id, orphan.id);
  });

  it("stops cleanly: no timer keeps draining after stop()", async () => {
    const accountId = "lifecycle";
    const delivered: unknown[] = [];
    const drain = drainFor(accountId, {
      intervalMs: 5,
      dispatch: async (payload) => {
        delivered.push(payload);
      },
    });
    drain.start();
    await admit(accountId, "event-lifecycle-1");
    drain.requestDrain();
    for (let tick = 0; tick < 40 && delivered.length === 0; tick += 1) await sleep(10);
    assert.equal(delivered.length, 1);

    await drain.stop();
    await drain.stop();

    await admit(accountId, "event-lifecycle-2");
    drain.requestDrain();
    await sleep(50);
    assert.equal(delivered.length, 1);
    assert.equal((await readEvent(accountId, "event-lifecycle-2")).status, "pending");
  });

  it("runs another pass for a wake that lands while the pump is settling", async () => {
    // `requestDrain()` can land in the microtask window between the pump's last
    // read of its wake flag and the pump handle being cleared; a wake dropped
    // there waits for the interval timer, which in production is 15 seconds of
    // silence on a live conversation. Which microtask that is depends on how
    // many awaits the pass happened to take, so the wake is driven at every
    // depth around it: all of them must produce the second pass.
    for (let depth = 0; depth <= 8; depth += 1) {
      const accountId = `wake-${depth}`;
      await admit(accountId, `event-wake-${depth}-1`);
      await admit(accountId, `event-wake-${depth}-2`);
      const delivered: unknown[] = [];
      let woken = false;
      let drain: ChannelIngressDrain | undefined;
      drain = drainFor(accountId, {
        // Far past the test: only the wake can produce the second pass.
        intervalMs: 600_000,
        batchLimit: 1,
        dispatch: async (payload) => {
          delivered.push(payload);
        },
        log: {
          drained: () => {
            if (woken) return;
            woken = true;
            void microtasks(depth).then(() => drain?.requestDrain());
          },
        },
      });

      drain.start();
      for (let tick = 0; tick < 50 && delivered.length < 2; tick += 1) await sleep(2);
      await drain.stop();

      assert.equal(delivered.length, 2, `the wake at microtask depth ${depth} was dropped`);
    }
  });

  it("keeps draining the backlog when one claim loses its fencing race", async () => {
    const accountId = "conflict";
    await admit(accountId, "event-conflict-1", "lane-conflict-1");
    await admit(accountId, "event-conflict-2", "lane-conflict-2");
    // No `refresh`: the lease keeper would notice the theft first, and the case
    // under test is the settle write itself losing the fence.
    const { refresh: _unrefreshed, ...queue } = sinkFor(accountId);
    const delivered: string[] = [];
    const abandoned: string[] = [];
    const drain = createChannelIngressDrain({
      queue,
      organizationId: ORGANIZATION_ID,
      channel: CHANNEL,
      accountId,
      workerId: `${CHANNEL}:${accountId}:drain`,
      abortSignal: new AbortController().signal,
      leaseMs: 5,
      // One worker: with a 5 ms lease a second in-flight claim would be stale
      // too, and the recovery below counts exactly the one under test.
      concurrency: 1,
      dispatch: async (payload) => {
        const event = (payload as { event: string }).event;
        delivered.push(event);
        if (event !== "event-conflict-1") return;
        // This claim's lease runs out mid-dispatch and another worker recovers
        // and re-claims the row, so the completion below is written by a worker
        // that no longer owns it.
        await sleep(20);
        assert.equal(
          await store.recoverStaleChannelIngress({ organizationId: ORGANIZATION_ID, accountId }),
          1,
        );
        assert.ok(
          await store.claimChannelIngress({
            organizationId: ORGANIZATION_ID,
            workerId: "worker-that-took-over",
            leaseMs: 60_000,
            accountId,
          }),
        );
      },
      log: { abandoned: (_claim, detail) => abandoned.push(detail.reason) },
    });

    const pass = await drain.drainOnce();

    assert.equal(pass.abandoned, 1);
    assert.equal(pass.completed, 1);
    assert.equal(abandoned.length, 1);
    // The lost claim did not end the pass: the next lane was still drained.
    assert.deepEqual(delivered, ["event-conflict-1", "event-conflict-2"]);
    assert.equal((await readEvent(accountId, "event-conflict-2")).status, "completed");
    const stolen = await readEvent(accountId, "event-conflict-1");
    assert.equal(stolen.status, "claimed");
    assert.equal(stolen.claimedBy, "worker-that-took-over");
  });

  it("aborts the dispatch and settles nothing when the lease is lost", async () => {
    const accountId = "lease-lost";
    await admit(accountId, "event-lease-lost");
    const abandoned: string[] = [];
    let sawAbort = false;
    const drain = drainFor(accountId, {
      // Refreshed every 20ms; the first refresh after the theft reports the row
      // is gone.
      leaseMs: 60,
      dispatch: async (_payload, _claim, signal) => {
        const afterTheLease = new Date(Date.now() + 60_000);
        await store.recoverStaleChannelIngress({
          organizationId: ORGANIZATION_ID,
          accountId,
          now: afterTheLease,
        });
        await store.claimChannelIngress({
          organizationId: ORGANIZATION_ID,
          workerId: "worker-that-took-over",
          leaseMs: 600_000,
          accountId,
          now: afterTheLease,
        });
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        sawAbort = signal.aborted;
      },
      log: { abandoned: (_claim, detail) => abandoned.push(detail.reason) },
    });

    const pass = await drain.drainOnce();

    assert.equal(sawAbort, true);
    assert.deepEqual(pass, {
      claimed: 1,
      completed: 0,
      retried: 0,
      deadLettered: 0,
      deferred: 0,
      abandoned: 1,
    });
    assert.deepEqual(abandoned, ["claim lease lost"]);
    // Neither completed nor failed: the row belongs to the worker that took it.
    const row = await readEvent(accountId, "event-lease-lost");
    assert.equal(row.status, "claimed");
    assert.equal(row.claimedBy, "worker-that-took-over");
  });

  it("releases a deferred event and completes a declined one", async () => {
    const accountId = "deferral";
    await admit(accountId, "event-deferred", "lane-deferred");
    await admit(accountId, "event-declined", "lane-declined");
    const deferrals: Array<{ reason: string; retryAt: Date }> = [];
    // A minute out, so the released row is not due again inside this pass.
    const now = Date.now() + 60_000;
    const drain = drainFor(accountId, {
      now: () => now,
      dispatch: async (payload) => {
        if ((payload as { event: string }).event !== "event-deferred") return;
        return {
          kind: "deferred",
          reason: "Route concurrency limit exceeded",
          retryAfterMs: 5_000,
        };
      },
      log: { deferred: (_claim, detail) => deferrals.push(detail) },
    });

    const pass = await drain.drainOnce();

    assert.equal(pass.deferred, 1);
    assert.equal(pass.completed, 1);
    assert.deepEqual(
      deferrals.map((detail) => detail.retryAt.getTime()),
      [now + 5_000],
    );
    // Back-pressure returns the message to the queue with its attempt intact;
    // a decision completes the row.
    const deferred = await readEvent(accountId, "event-deferred");
    assert.equal(deferred.status, "pending");
    assert.equal(deferred.attempts, 0);
    assert.equal(deferred.availableAt.getTime(), now + 5_000);
    assert.equal(deferred.lastError, "Route concurrency limit exceeded");
    assert.equal((await readEvent(accountId, "event-declined")).status, "completed");
  });

  /**
   * Back-pressure that never clears is a stuck row. A release gives the attempt
   * back, so the retry budget cannot end it; the sink's release budget does,
   * and the operator gets a dead letter to resubmit instead of a lane that
   * quietly never moves.
   */
  it("dead-letters an event the plane defers past its release budget", async () => {
    const accountId = "release-budget";
    await admit(accountId, "event-forever", "lane-forever");
    const exhausted: string[] = [];
    const queue = sinkFor(accountId, {
      releaseBudget: { maxReleases: 2, pendingTtlMs: 24 * 60 * 60 * 1_000 },
      onReleaseBudgetExhausted: (record) => exhausted.push(record.failedReason ?? ""),
    });
    const drain = createChannelIngressDrain({
      queue,
      organizationId: ORGANIZATION_ID,
      channel: CHANNEL,
      accountId,
      workerId: `${CHANNEL}:${accountId}:drain`,
      abortSignal: new AbortController().signal,
      resolveNonRetryableFailure: resolveHubIngressNonRetryableFailure,
      dispatch: async () => ({
        kind: "deferred" as const,
        reason: "Route concurrency limit exceeded",
        retryAfterMs: 0,
      }),
    });

    // `retryAfterMs: 0` makes the released row due again immediately, so one
    // pass keeps re-claiming it — exactly the loop the budget has to end.
    const pass = await drain.drainOnce();
    assert.equal(pass.deferred, 2);

    const settled = await readEvent(accountId, "event-forever");
    assert.equal(settled.status, "dead_letter");
    assert.equal(settled.releases, 2);
    assert.equal(settled.failedReason, "release-budget-exhausted");
    assert.deepEqual(exhausted, ["release-budget-exhausted"]);
    // Terminal: the next pass has nothing to claim.
    assert.equal((await drain.drainOnce()).claimed, 0);
    await drain.stop();
  });
});

/** Yield `count` microtask turns, so a wake can be aimed at one of them. */
async function microtasks(count: number): Promise<void> {
  for (let step = 0; step < count; step += 1) await Promise.resolve();
}

describe("concurrent slash commands", () => {
  // A Slack Route that opens a thread per root message: the root is no session.
  const threadAnchored = {
    channel: "slack",
    accountId: "commands",
    routes: [
      {
        where: { dm: false, groups: ["all"], conversations: [] },
        defaults: { bindingKey: "thread", replyAnchor: "thread" },
      },
    ],
  } as unknown as CompiledChannelAccount;
  const command = (triggerId: string): InboundMessage => ({
    channel: "slack",
    accountId: "commands",
    senderIdentity: "slack:U0ALICE",
    text: "status",
    mentionedBot: true,
    externalMessageId: triggerId,
    conversation: { kind: "channel", id: "C0ROOT", rootConversationId: "C0ROOT", threadId: null },
  });

  it("dispatches two root /status commands side by side, not one behind the other", async () => {
    const accountId = "commands";
    const sink = sinkFor(accountId, {
      sessionLaneKey: (payload) =>
        sessionLaneKey(threadAnchored, command((payload as { event: string }).event), "status"),
    });
    for (const triggerId of ["trigger-a", "trigger-b"]) {
      await sink.enqueue({
        channel: CHANNEL,
        accountId,
        externalEventId: triggerId,
        externalMessageId: triggerId,
        externalConversationId: "C0ROOT",
        // The transport's lane: every native command of the channel shares it.
        laneKey: "slack:commands:C0ROOT:root",
        payload: { event: triggerId },
      });
    }
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running: string[] = [];
    const drain = drainFor(accountId, {
      intervalMs: 600_000,
      dispatch: async (payload) => {
        running.push((payload as { event: string }).event);
        await held;
      },
    });
    drain.start();
    try {
      for (let tick = 0; tick < 100 && running.length < 2; tick += 1) await sleep(5);
      assert.deepEqual(running.toSorted(), ["trigger-a", "trigger-b"], "both in flight at once");
    } finally {
      release();
      await drain.stop();
    }
  });
});
