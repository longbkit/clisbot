// L2 Socket Mode transport: ack-first event dispatch → the shared L3 event
// facts (ctxPayload build + explicit-mention gating + im/mpim app_mention
// dedup + own-message flag). The key assertion is that the ctxPayload `To` /
// `OriginatingTo` is the CONVERSATION id, not the message ts (the pinned
// source builds `to` from `channel:${channelId}`, messages.ts:38).

import assert from "node:assert/strict";
import type { SocketModeClient } from "@slack/socket-mode";
import { describe, expect, it } from "vitest";
import type { ChannelInboundEvent } from "@getpaseo/channels-shared";
import { buildInboundCtxPayload } from "@getpaseo/channels-shared";
import { createSlackSocketTransport } from "./socket-mode.js";
import type { SocketEventEnvelope } from "./socket-event-filter.js";

/** A minimal EventEmitter-shaped fake: register handlers, then `emit` them.
 * `start` is a no-op (the test emits event handlers directly, never the loop);
 * `disconnect` is the SocketModeClient teardown the transport calls on abort. */
function fakeSocketClient() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  let disconnectCalls = 0;
  const client = {
    on(event: string, fn: (...args: unknown[]) => void): unknown {
      (handlers[event] ??= []).push(fn);
      return client;
    },
    off(event: string, fn: (...args: unknown[]) => void): unknown {
      const arr = handlers[event];
      if (arr !== undefined) handlers[event] = arr.filter((h) => h !== fn);
      return client;
    },
    async start(): Promise<void> {},
    async disconnect(): Promise<void> {
      disconnectCalls += 1;
    },
    get disconnectCalls(): number {
      return disconnectCalls;
    },
    emit(event: string, payload: unknown): void {
      const arr = handlers[event];
      if (arr !== undefined) for (const fn of arr) fn(payload);
    },
  };
  return client;
}

function envelope(
  body: Record<string, unknown>,
  event: Record<string, unknown>,
): SocketEventEnvelope {
  return {
    // (ack ordering is covered by the L3 redelivery semantic, not here.)
    ack: async () => {},
    envelope_id: `env-${Math.random()}`,
    body,
    event,
  };
}

function makeTransport(onInbound: (event: ChannelInboundEvent) => Promise<void>) {
  const client = fakeSocketClient() as unknown as SocketModeClient;
  const transport = createSlackSocketTransport({
    client,
    identity: { botUserId: "U_BOT" },
    onInbound,
    abortSignal: new AbortController().signal,
  });
  return { client, transport };
}

describe("slack socket transport", () => {
  it("builds a ctxPayload whose To/OriginatingTo is the conversation id, with explicit-mention gating", async () => {
    const seen: ChannelInboundEvent[] = [];
    const { client } = makeTransport(async (event) => {
      seen.push(event);
    });

    // An explicit `<@U_BOT>` mention in a channel message.
    client.emit(
      "message",
      envelope(
        { channel: "C123", channel_type: "channel" },
        {
          channel: "C123",
          channel_type: "channel",
          ts: "1700.000001",
          user: "U_USER",
          text: "<@U_BOT> hi",
        },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toHaveLength(1);
    const [inbound] = seen;
    assert.ok(inbound, "the mentioned message dispatches to the L3");
    expect(inbound.wasMentioned).toBe(true);
    expect(inbound.externalConversationId).toBe("C123");
    expect(inbound.externalMessageId).toBe("1700.000001");
    expect(inbound.isOwnMessage).toBeUndefined();

    // The ctxPayload the Hub plane reads: To/OriginatingTo must be the
    // conversation id, NOT the message ts.
    const payload = buildInboundCtxPayload(inbound, "acct");
    expect(payload["To"]).toBe("C123");
    expect(payload["OriginatingTo"]).toBe("C123");
    expect(payload["To"]).not.toBe("1700.000001");
    expect(payload["ChatId"]).toBe("C123");
    expect(payload["MessageSid"]).toBe("1700.000001");
    expect(payload["WasMentioned"]).toBe(true);
  });

  it("does NOT gate a plain channel message without a mention", async () => {
    const seen: ChannelInboundEvent[] = [];
    const { client } = makeTransport(async (event) => {
      seen.push(event);
    });

    client.emit(
      "message",
      envelope(
        { channel: "C123", channel_type: "channel" },
        {
          channel: "C123",
          channel_type: "channel",
          ts: "1700.000002",
          user: "U_USER",
          text: "no mention here",
        },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.wasMentioned).toBe(false);
  });

  it("flags bot-authored messages as own (the L3 drops them)", async () => {
    const seen: ChannelInboundEvent[] = [];
    const { client } = makeTransport(async (event) => {
      seen.push(event);
    });

    client.emit(
      "message",
      envelope(
        { channel: "C123", channel_type: "channel" },
        {
          channel: "C123",
          channel_type: "channel",
          ts: "1700.000003",
          user: "U_BOT",
          text: "bot talking to itself",
        },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The transport passes the fact through; the L3's own-message filter drops it.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.isOwnMessage).toBe(true);
  });

  it("drops the app_mention duplicate in an im (the `message` event already covers it)", async () => {
    const seen: ChannelInboundEvent[] = [];
    const { client } = makeTransport(async (event) => {
      seen.push(event);
    });

    client.emit(
      "app_mention",
      envelope(
        { channel: "D456", channel_type: "im" },
        { channel: "D456", channel_type: "im", ts: "1700.000004" },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toHaveLength(0);
  });

  it("tears the socket down when the account aborts", async () => {
    const fake = fakeSocketClient();
    const client = fake as unknown as SocketModeClient;
    const controller = new AbortController();
    const transport = createSlackSocketTransport({
      client,
      identity: { botUserId: "U_BOT" },
      onInbound: async () => {},
      abortSignal: controller.signal,
    });

    const running = transport.start();
    // Let the loop's client.start() settle; the session now waits for
    // disconnect/abort.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.disconnectCalls).toBe(0);

    controller.abort();
    await running;
    expect(fake.disconnectCalls).toBe(1);
  });

  it("counts an app_mention in a channel as a mention", async () => {
    const seen: ChannelInboundEvent[] = [];
    const { client } = makeTransport(async (event) => {
      seen.push(event);
    });

    client.emit(
      "app_mention",
      envelope(
        { channel: "C123", channel_type: "channel" },
        {
          channel: "C123",
          channel_type: "channel",
          ts: "1700.000005",
          user: "U_USER",
          text: "<@U_BOT> go",
        },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.wasMentioned).toBe(true);
    expect(seen[0]?.chatType).toBe("channel");
  });
});
