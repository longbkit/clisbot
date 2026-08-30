// L3 shared monitor: in-flight dedupe, own-message filter, ctxPayload shape,
// the inbound ledger record/consume-mark (blueprint §6.5 verification:
// duplicate external message id → one row, no second dispatch; restart
// replay → consumed rows not re-dispatched).

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

describe("createInboundEventProcessor", () => {
  it("hands a first-sight event to the host with the flat ctxPayload", async () => {
    const handled: InboundReplyParams[] = [];
    const processor = createInboundEventProcessor({
      hostRuntime: fakeRuntime(handled),
      channel: "telegram",
      accountId: "work",
    });
    const decision = await processor.process(event());
    expect(decision.dispatched).toBe(true);
    expect(handled).toHaveLength(1);
    expect(handled[0]!.channel).toBe("telegram");
    expect(handled[0]!.accountId).toBe("work");
    expect(handled[0]!.ctxPayload["Body"]).toBe("hello");
  });

  it("drops an in-flight transport redelivery", async () => {
    const handled: InboundReplyParams[] = [];
    const processor = createInboundEventProcessor({
      hostRuntime: fakeRuntime(handled),
      channel: "telegram",
      accountId: "work",
    });
    await processor.process(event());
    const again = await processor.process(event());
    expect(again).toEqual({ dispatched: false, reason: "in-flight duplicate" });
    expect(handled).toHaveLength(1);
  });

  it("drops the own-bot message", async () => {
    const handled: InboundReplyParams[] = [];
    const processor = createInboundEventProcessor({
      hostRuntime: fakeRuntime(handled),
      channel: "telegram",
      accountId: "work",
      botId: "777",
    });
    const decision = await processor.process(event({ senderId: "777" }));
    expect(decision).toEqual({ dispatched: false, reason: "own message" });
    expect(handled).toHaveLength(0);
  });

  it("drops an empty body", async () => {
    const handled: InboundReplyParams[] = [];
    const processor = createInboundEventProcessor({
      hostRuntime: fakeRuntime(handled),
      channel: "telegram",
      accountId: "work",
    });
    const decision = await processor.process(event({ body: "   " }));
    expect(decision).toEqual({ dispatched: false, reason: "empty body" });
    expect(handled).toHaveLength(0);
  });

  it("dispatches a manifest-only body (G6: media-only with attachments is admitted)", async () => {
    const handled: InboundReplyParams[] = [];
    const processor = createInboundEventProcessor({
      hostRuntime: fakeRuntime(handled),
      channel: "telegram",
      accountId: "work",
    });
    const manifest = "[Attached files]\n1. photo (photo, 1024 bytes) → /dl/1-1-photo.jpg";
    const decision = await processor.process(event({ body: manifest }));
    expect(decision.dispatched).toBe(true);
    expect(handled).toHaveLength(1);
    expect(handled[0]?.ctxPayload["Body"]).toBe(manifest);
  });

  it("records the ledger row before the handoff and consume-marks on settle", async () => {
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
    const row = rows.get("msg-1")!;
    expect(row.created).toBe(true);
    expect(row.consumed).toBe(true);
    expect(row.turnId).toBe(inboundTurnId(event()));
  });

  it("duplicate external message id → one ledger row, no second dispatch", async () => {
    const { sink, rows } = recordingSink(new Set(["msg-1"]));
    const handled: InboundReplyParams[] = [];
    const runtime = fakeRuntime(handled);
    runtime.inboundLedger = sink;
    const processor = createInboundEventProcessor({
      hostRuntime: runtime,
      channel: "telegram",
      accountId: "work",
    });
    const decision = await processor.process(event({ externalEventId: "evt-restart-1" }));
    expect(decision).toEqual({ dispatched: false, reason: "ledger replay" });
    expect(handled).toHaveLength(0);
    expect([...rows.values()]).toHaveLength(1);
  });

  it("leaves the row recorded (not consumed) when the plane declines", async () => {
    const { sink, rows } = recordingSink(new Set());
    const handled: InboundReplyParams[] = [];
    const runtime = fakeRuntime(handled, { dispatched: false });
    runtime.inboundLedger = sink;
    const processor = createInboundEventProcessor({
      hostRuntime: runtime,
      channel: "telegram",
      accountId: "work",
    });
    const decision = await processor.process(event());
    expect(decision).toEqual({ dispatched: false, reason: "plane declined" });
    const row = rows.get("msg-1")!;
    expect(row.created).toBe(true);
    expect(row.consumed).toBe(false);
  });

  it("keeps polling on a handoff fault", async () => {
    const runtime: HostRuntime = {
      onInboundReply: async () => {
        throw new Error("plane down");
      },
      state: fakeKeyedStoreRoot(),
      logging: { getChildLogger: () => ({ warn: () => undefined }) },
      channel: {},
    };
    const processor = createInboundEventProcessor({
      hostRuntime: runtime,
      channel: "telegram",
      accountId: "work",
    });
    const decision = await processor.process(event());
    expect(decision).toEqual({ dispatched: false, reason: "handoff fault" });
    // The transport loop continues: a second (different) event still processes.
    const second = await processor.process(
      event({ externalEventId: "evt-2", externalMessageId: "msg-2" }),
    );
    assert.equal(second.reason, "handoff fault");
  });

  it("evicts oldest first-sight ids past the cap", async () => {
    const handled: InboundReplyParams[] = [];
    const processor = createInboundEventProcessor({
      hostRuntime: fakeRuntime(handled),
      channel: "telegram",
      accountId: "work",
      seenCap: 2,
    });
    await processor.process(event({ externalEventId: "e1", externalMessageId: "m1" }));
    await processor.process(event({ externalEventId: "e2", externalMessageId: "m2" }));
    await processor.process(event({ externalEventId: "e3", externalMessageId: "m3" }));
    // e1 was evicted: its redelivery is a first-sight again (the ledger, not
    // the in-flight set, owns durable dedupe).
    const redelivered = await processor.process(
      event({ externalEventId: "e1", externalMessageId: "m1" }),
    );
    expect(redelivered.dispatched).toBe(true);
    expect(processor.seenSize).toBe(2);
  });
});
