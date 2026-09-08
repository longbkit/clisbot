// L3 shared monitor: in-flight dedupe, own-message filter, ctxPayload shape,
// and durable admission (blueprint §6.5 verification: duplicate external event
// id → one admission, no second dispatch; restart replay → an already-admitted
// event is not re-admitted).
//
// Production hosts run with an `inboundQueue`, so that is what these cases
// wire. Two cases named "legacy ledger-only host" cover the compatibility path
// a host without a queue still takes (unit fixtures, pre-queue hosts).

import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import type {
  HostKeyedStore,
  HostKeyedStoreOptions,
  HostKeyedStoreRoot,
  HostRuntime,
  InboundReplyParams,
  InboundReplyResult,
  InboundLedgerSink,
  InboundQueueSink,
} from "./host.js";
import { buildInboundCtxPayload, createInboundEventProcessor, inboundTurnId } from "./monitor.js";

function fakeKeyedStoreRoot(): HostKeyedStoreRoot {
  return {
    openKeyedStore(_options: HostKeyedStoreOptions): HostKeyedStore {
      return {
        register: async () => undefined,
        registerIfAbsent: async () => true,
        update: async () => false,
        lookup: async () => undefined,
        consume: async () => undefined,
        delete: async () => false,
        entries: async () => [],
        clear: async () => undefined,
      };
    },
  };
}

function fakeRuntime(
  handled: InboundReplyParams[],
  result: InboundReplyResult = { dispatched: true },
): HostRuntime {
  return {
    onInboundReply: async (params) => {
      handled.push(params);
      return result;
    },
    state: fakeKeyedStoreRoot(),
    logging: {
      getChildLogger: () => ({
        warn: () => undefined,
        debug: () => undefined,
        info: () => undefined,
      }),
    },
    channel: {},
  };
}

/** A recording ledger sink: `known` = ids whose row pre-exists (replay). */
function recordingSink(known: Set<string>) {
  const rows = new Map<string, { created: boolean; consumed: boolean; turnId?: string }>();
  const sink: InboundLedgerSink = {
    record: async ({ externalMessageId }) => {
      const created = !known.has(externalMessageId) && !rows.has(externalMessageId);
      rows.set(externalMessageId, { created, consumed: false });
      return { created };
    },
    consume: async ({ externalMessageId, turnId }) => {
      const row = rows.get(externalMessageId);
      if (row !== undefined) {
        row.consumed = true;
        row.turnId = turnId;
      }
    },
  };
  return { sink, rows };
}

const event = (
  over: Partial<Parameters<typeof buildInboundCtxPayload>[0]> = {},
): Parameters<typeof buildInboundCtxPayload>[0] => ({
  channel: "telegram",
  externalEventId: "evt-1",
  externalMessageId: "msg-1",
  externalConversationId: "-100123",
  chatType: "group",
  messageThreadId: null,
  senderId: "42",
  body: "hello",
  wasMentioned: true,
  timestampMs: 1_700_000_000_000,
  ...over,
});

describe("buildInboundCtxPayload", () => {
  it("emits the flat pinned-contract keys (inbound.md)", () => {
    const ctx = buildInboundCtxPayload(event(), "work");
    expect(ctx["Body"]).toBe("hello");
    expect(ctx["BodyForAgent"]).toBe("hello");
    expect(ctx["ChatType"]).toBe("group");
    expect(ctx["ChatId"]).toBe("-100123");
    expect(ctx["From"]).toBe("42");
    expect(ctx["To"]).toBe("-100123");
    expect(ctx["MessageSid"]).toBe("msg-1");
    expect(ctx["Timestamp"]).toBe(1_700_000_000_000);
    expect(ctx["SenderId"]).toBe("42");
    expect(ctx["WasMentioned"]).toBe(true);
    expect(ctx["CommandAuthorized"]).toBe(false);
    expect(ctx["AccountId"]).toBe("work");
    expect(ctx["OriginatingChannel"]).toBe("telegram");
    expect(ctx["OriginatingTo"]).toBe("-100123");
    expect("MessageThreadId" in ctx).toBe(false);
    expect("conversation" in ctx).toBe(false);
    expect("messageId" in ctx).toBe(false);
  });

  it("defaults an event with no kind to a plain message and carries no facts", () => {
    const ctx = buildInboundCtxPayload(event(), "work");
    expect(ctx["EventKind"]).toBe("message");
    expect("EventFacts" in ctx).toBe(false);
  });

  it("carries the inbound family and its structured facts", () => {
    const ctx = buildInboundCtxPayload(
      event({
        kind: "reaction",
        body: "[Reaction] 👍 on message 17",
        wasMentioned: false,
        facts: { reaction: { emoji: "👍", added: true, messageId: "17", actorId: "42" } },
      }),
      "work",
    );
    expect(ctx["EventKind"]).toBe("reaction");
    expect(ctx["EventFacts"]).toEqual({
      reaction: { emoji: "👍", added: true, messageId: "17", actorId: "42" },
    });
  });

  it("carries the thread id and reply target when present", () => {
    const ctx = buildInboundCtxPayload(
      event({ messageThreadId: "42:17", replyTo: "reply-target", conversationLabel: "#infra" }),
      "work",
    );
    expect(ctx["MessageThreadId"]).toBe("42:17");
    expect(ctx["To"]).toBe("reply-target");
    expect(ctx["ConversationLabel"]).toBe("#infra");
  });
});

/**
 * A recording durable queue: `known` = event ids a previous process already
 * admitted, so this run sees them as a replay. `failFirstEnqueue` makes the
 * first admission fail the way a store outage would.
 */
function recordingQueue(
  known: Set<string> = new Set(),
  options: { failFirstEnqueue?: boolean } = {},
) {
  const admitted: Array<Parameters<InboundQueueSink["enqueue"]>[0]> = [];
  const held = new Set(known);
  let failures = options.failFirstEnqueue === true ? 1 : 0;
  const queue: InboundQueueSink = {
    enqueue: async (params) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("queue unavailable");
      }
      admitted.push(params);
      const created = !held.has(params.externalEventId);
      held.add(params.externalEventId);
      return { created, id: params.externalEventId };
    },
    claim: async () => undefined,
    complete: async () => undefined,
    fail: async () => undefined,
  };
  return { queue, admitted };
}

/** The production wiring: a host with a durable queue and no ledger. */
function queuedProcessor(
  queue: InboundQueueSink,
  options: { botId?: string; seenCap?: number } = {},
) {
  const runtime = fakeRuntime([]);
  runtime.inboundQueue = queue;
  return createInboundEventProcessor({
    hostRuntime: runtime,
    channel: "telegram",
    accountId: "work",
    ...options,
  });
}

describe("createInboundEventProcessor", () => {
  it("admits to the durable queue before handoff and leaves dispatch to the drain", async () => {
    const handled: InboundReplyParams[] = [];
    const { queue, admitted } = recordingQueue();
    const { sink, rows } = recordingSink(new Set());
    const runtime = fakeRuntime(handled);
    runtime.inboundQueue = queue;
    runtime.inboundLedger = sink;
    const processor = createInboundEventProcessor({
      hostRuntime: runtime,
      channel: "telegram",
      accountId: "work",
    });

    const decision = await processor.process(event());

    expect(decision).toEqual({ dispatched: true, reason: "queued" });
    expect(handled).toHaveLength(0);
    expect(admitted).toHaveLength(1);
    expect(admitted[0]).toMatchObject({
      externalEventId: "evt-1",
      externalMessageId: "msg-1",
      laneKey: "telegram:work:-100123:root",
    });
    // The stored payload is what the drain will hand the plane: the same flat
    // ctxPayload the ledger-only path passed straight to `onInboundReply`.
    const payload = admitted[0]!.payload as { ctxPayload: Record<string, unknown> };
    expect(payload.ctxPayload["Body"]).toBe("hello");
    expect(payload.ctxPayload["MessageSid"]).toBe("msg-1");
    // The family + facts are durable too: the drain routes off the stored copy.
    expect(payload.ctxPayload["EventKind"]).toBe("message");
    // The ledger row is an audit join written after admission; the drain, not
    // the monitor, consume-marks it when the dispatch settles.
    expect(rows.get("msg-1")).toEqual({ created: true, consumed: false });
  });

  it("drops an in-flight transport redelivery before it reaches the queue", async () => {
    const { queue, admitted } = recordingQueue();
    const processor = queuedProcessor(queue);

    await processor.process(event());
    const again = await processor.process(event());

    expect(again).toEqual({ dispatched: false, reason: "in-flight duplicate" });
    expect(admitted).toHaveLength(1);
  });

  it("drops the own-bot message", async () => {
    const { queue, admitted } = recordingQueue();
    const processor = queuedProcessor(queue, { botId: "777" });

    const decision = await processor.process(event({ senderId: "777" }));

    expect(decision).toEqual({ dispatched: false, reason: "own message" });
    expect(admitted).toHaveLength(0);
  });

  it("drops an empty body", async () => {
    const { queue, admitted } = recordingQueue();
    const processor = queuedProcessor(queue);

    const decision = await processor.process(event({ body: "   " }));

    expect(decision).toEqual({ dispatched: false, reason: "empty body" });
    expect(admitted).toHaveLength(0);
  });

  it("admits a manifest-only body (G6: media-only with attachments is admitted)", async () => {
    const { queue, admitted } = recordingQueue();
    const processor = queuedProcessor(queue);
    const manifest = "[Attached files]\n1. photo (photo, 1024 bytes) → /dl/1-1-photo.jpg";

    const decision = await processor.process(event({ body: manifest }));

    expect(decision.dispatched).toBe(true);
    expect(admitted).toHaveLength(1);
    const payload = admitted[0]!.payload as { ctxPayload: Record<string, unknown> };
    expect(payload.ctxPayload["Body"]).toBe(manifest);
  });

  it("treats a restart redelivery of an admitted event as a queue replay", async () => {
    const handled: InboundReplyParams[] = [];
    // A fresh processor (the in-flight set died with the last process) meeting
    // an event id the queue already holds: durable dedupe, not in-flight.
    const { queue, admitted } = recordingQueue(new Set(["evt-1"]));
    const { sink, rows } = recordingSink(new Set());
    const runtime = fakeRuntime(handled);
    runtime.inboundQueue = queue;
    runtime.inboundLedger = sink;
    const processor = createInboundEventProcessor({
      hostRuntime: runtime,
      channel: "telegram",
      accountId: "work",
    });

    const decision = await processor.process(event());

    expect(decision).toEqual({ dispatched: false, reason: "queue replay" });
    expect(handled).toHaveLength(0);
    expect(admitted).toHaveLength(1);
    expect([...rows.values()]).toHaveLength(0);
  });

  it("forgets a failed admission so the provider's redelivery is admitted", async () => {
    const { queue, admitted } = recordingQueue(new Set(), { failFirstEnqueue: true });
    const processor = queuedProcessor(queue);

    // Admission is the ACK/offset boundary: the provider must be free to send
    // the event again, and the in-flight set must not answer that with a
    // "duplicate" it never actually admitted.
    await expect(processor.process(event())).rejects.toThrow("queue unavailable");
    expect(processor.seenSize).toBe(0);

    const retried = await processor.process(event());

    expect(retried).toEqual({ dispatched: true, reason: "queued" });
    expect(admitted).toHaveLength(1);
  });

  it("evicts oldest first-sight ids past the cap", async () => {
    const { queue, admitted } = recordingQueue();
    const processor = queuedProcessor(queue, { seenCap: 2 });

    await processor.process(event({ externalEventId: "e1", externalMessageId: "m1" }));
    await processor.process(event({ externalEventId: "e2", externalMessageId: "m2" }));
    await processor.process(event({ externalEventId: "e3", externalMessageId: "m3" }));
    // e1 was evicted: its redelivery is a first-sight again and reaches the
    // queue, which owns durable dedupe (here it answers `created: false`).
    const redelivered = await processor.process(
      event({ externalEventId: "e1", externalMessageId: "m1" }),
    );

    expect(redelivered).toEqual({ dispatched: false, reason: "queue replay" });
    expect(admitted).toHaveLength(4);
    expect(processor.seenSize).toBe(2);
  });

  it("legacy ledger-only host: records before the handoff, consume-marks on settle, skips a replay", async () => {
    const handled: InboundReplyParams[] = [];
    const { sink, rows } = recordingSink(new Set());
    const runtime = fakeRuntime(handled);
    runtime.inboundLedger = sink;
    const processor = createInboundEventProcessor({
      hostRuntime: runtime,
      channel: "telegram",
      accountId: "work",
    });

    const decision = await processor.process(event());

    expect(decision.dispatched).toBe(true);
    expect(handled).toHaveLength(1);
    expect(handled[0]!.ctxPayload["Body"]).toBe("hello");
    expect(rows.get("msg-1")).toEqual({
      created: true,
      consumed: true,
      turnId: inboundTurnId(event()),
    });

    const replayed = recordingSink(new Set(["msg-1"]));
    const afterRestart = fakeRuntime(handled);
    afterRestart.inboundLedger = replayed.sink;
    const replayDecision = await createInboundEventProcessor({
      hostRuntime: afterRestart,
      channel: "telegram",
      accountId: "work",
    }).process(event({ externalEventId: "evt-restart-1" }));

    expect(replayDecision).toEqual({ dispatched: false, reason: "ledger replay" });
    expect(handled).toHaveLength(1);
  });

  it("legacy ledger-only host: a decline leaves the row recorded and a fault keeps polling", async () => {
    const { sink, rows } = recordingSink(new Set());
    const declining = fakeRuntime([], { dispatched: false });
    declining.inboundLedger = sink;

    const declined = await createInboundEventProcessor({
      hostRuntime: declining,
      channel: "telegram",
      accountId: "work",
    }).process(event());

    expect(declined).toEqual({ dispatched: false, reason: "plane declined" });
    expect(rows.get("msg-1")).toEqual({ created: true, consumed: false });

    // Still a ledger-only host: production always has a queue or a ledger, so a
    // runtime with neither is not a posture worth asserting.
    const faulting: HostRuntime = {
      onInboundReply: async () => {
        throw new Error("plane down");
      },
      state: fakeKeyedStoreRoot(),
      logging: { getChildLogger: () => ({ warn: () => undefined }) },
      channel: {},
      inboundLedger: recordingSink(new Set()).sink,
    };
    const processor = createInboundEventProcessor({
      hostRuntime: faulting,
      channel: "telegram",
      accountId: "work",
    });

    expect(await processor.process(event())).toEqual({
      dispatched: false,
      reason: "handoff fault",
    });
    // The transport loop continues: a second (different) event still processes.
    const second = await processor.process(
      event({ externalEventId: "evt-2", externalMessageId: "msg-2" }),
    );
    assert.equal(second.reason, "handoff fault");
  });
});
