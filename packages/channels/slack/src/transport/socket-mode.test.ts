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

function makeTransport(
  onInbound: (event: ChannelInboundEvent) => Promise<void>,
) {
  const client = fakeSocketClient() as unknown as SocketModeClient;
  const transport = createSlackSocketTransport({
    client,
    identity: { botUserId: "U_BOT" },
    onInbound,
    abortSignal: new AbortController().signal,
  });
  return { client, transport };
}

function makeInteractiveTransport(
  onInteractive: (body: Record<string, unknown>) => Promise<void>,
) {
  const client = fakeSocketClient() as unknown as SocketModeClient;
  const transport = createSlackSocketTransport({
    client,
    identity: { botUserId: "U_BOT" },
    onInbound: async () => {},
    onInteractive,
    abortSignal: new AbortController().signal,
  });
  return { client, transport };
}

function blockActionsEnvelope(overrides: Record<string, unknown> = {}): {
  body: Record<string, unknown>;
  event: Record<string, unknown>;
} {
  const body = {
    type: "block_actions",
    user: { id: "U0BOB" },
    channel: "C123",
    container: {
      type: "message",
      message_ts: "1700.000009",
      channel_id: "C123",
    },
    message: { channel: "C123", ts: "1700.000009", thread_ts: "1700.000008" },
    actions: [
      {
        action_id: "approval_action_1",
        block_id: "b1",
        value: "allow:req-1",
        type: "button",
      },
    ],
    trigger_id: "T1",
    ...overrides,
  };
  return { body, event: { ...body } };
}

describe("slack socket transport: shared app routing", () => {
  it("routes and acks one envelope only in the matching workspace", async () => {
    const fake = fakeSocketClient();
    const client = fake as unknown as SocketModeClient;
    const teamOne: ChannelInboundEvent[] = [];
    const teamTwo: ChannelInboundEvent[] = [];
    for (const [teamId, sink] of [
      ["T1", teamOne],
      ["T2", teamTwo],
    ] as const) {
      createSlackSocketTransport({
        client,
        sharedClient: true,
        identity: { teamId, botUserId: `BOT_${teamId}` },
        onInbound: async (event) => {
          sink.push(event);
        },
        abortSignal: new AbortController().signal,
      });
    }
    let ackCount = 0;
    client.emit("message", {
      envelope_id: "env-team-two",
      body: { team_id: "T2" },
      event: {
        type: "message",
        user: "U1",
        channel: "C1",
        ts: "1700.000001",
        text: "hello",
      },
      ack: async () => {
        ackCount += 1;
      },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(teamOne).toHaveLength(0);
    expect(teamTwo).toHaveLength(1);
    expect(ackCount).toBe(1);
  });

  it("fails closed instead of broadcasting an envelope without team identity", async () => {
    const fake = fakeSocketClient();
    const client = fake as unknown as SocketModeClient;
    let dispatches = 0;
    let acknowledgements = 0;
    createSlackSocketTransport({
      client,
      sharedClient: true,
      identity: { teamId: "T1", botUserId: "BOT_T1" },
      onInbound: async () => {
        dispatches += 1;
      },
      abortSignal: new AbortController().signal,
    });
    client.emit("message", {
      envelope_id: "env-unattributed",
      body: {},
      event: { type: "message", user: "U1", channel: "C1", ts: "1700.000002" },
      ack: async () => {
        acknowledgements += 1;
      },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dispatches).toBe(0);
    expect(acknowledgements).toBe(0);
  });
});

describe("slack socket transport: block_actions (the approval-card click)", () => {
  it("hands the raw body to onInteractive and acks the envelope", async () => {
    const seen: Record<string, unknown>[] = [];
    const { client } = makeInteractiveTransport(async (body) => {
      seen.push(body);
    });
    let acked = false;
    // The wire emits on the ENVELOPE type "interactive" (the Slack Socket
    // Mode reference: every interaction payload — block_actions included —
    // rides envelope type "interactive"; @slack/socket-mode emits
    // non-events_api envelopes on that type).
    client.emit("interactive", {
      ...blockActionsEnvelope(),
      ack: async () => {
        acked = true;
      },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toHaveLength(1);
    // The RAW wire body goes to the seam: the vertical's parser narrows the
    // envelope, the hub's card-value parser owns the value format.
    assert.equal(seen[0]?.["type"], "block_actions");
    const firstAction = (
      seen[0]?.["actions"] as Record<string, unknown>[] | undefined
    )?.[0];
    assert.deepEqual(firstAction?.["value"], "allow:req-1");
    assert.equal(
      acked,
      true,
      "the envelope is acked (ack-first redelivery semantic)",
    );
  });

  it("acks and drops a non-block_actions interaction before the seam", async () => {
    const seen: Record<string, unknown>[] = [];
    const { client } = makeInteractiveTransport(async (body) => {
      seen.push(body);
    });
    let acked = false;
    client.emit("interactive", {
      body: { type: "view_submission", user: { id: "U0BOB" } },
      ack: async () => {
        acked = true;
      },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toHaveLength(0);
    assert.equal(acked, true, "a modal submission is acked, never handed over");
  });

  it("does NOT re-dispatch a redelivered envelope id", async () => {
    const seen: Record<string, unknown>[] = [];
    const { client } = makeInteractiveTransport(async (body) => {
      seen.push(body);
    });
    const env = {
      ...blockActionsEnvelope(),
      envelope_id: "env-same",
      ack: async () => {},
    } as never;
    client.emit("interactive", env);
    client.emit("interactive", env); // the same envelope id again
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The second delivery of the same envelope is dropped.
    expect(seen).toHaveLength(1);
  });

  it("acks and ignores block_actions when no interactive seam is wired", async () => {
    let acked = false;
    const fake = fakeSocketClient();
    const client = fake as unknown as SocketModeClient;
    createSlackSocketTransport({
      client,
      identity: { botUserId: "U_BOT" },
      onInbound: async () => {},
      abortSignal: new AbortController().signal,
    });
    client.emit("interactive", {
      ...blockActionsEnvelope(),
      ack: async () => {
        acked = true;
      },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      acked,
      true,
      "no seam: the envelope is still acked (never redelivered)",
    );
  });
});

/** Poll a condition until it holds (or the bound elapses) — the file pipeline
 * takes a few event-loop turns, so a single `setTimeout(0)` is not enough. */
async function waitUntil(cond: () => boolean, boundMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > boundMs) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function makeMediaTransport(
  onInbound: (event: ChannelInboundEvent) => Promise<void>,
  media: {
    downloadDir: string;
    fetchImpl?: typeof globalThis.fetch;
  },
) {
  const client = fakeSocketClient() as unknown as SocketModeClient;
  const transport = createSlackSocketTransport({
    client,
    identity: { botUserId: "U_BOT" },
    onInbound,
    abortSignal: new AbortController().signal,
    media: { accountId: "acct", botToken: "xoxb-test", ...media },
  });
  return { client, transport };
}

describe("slack socket transport: inbound media fold (F-06, G5+G6)", () => {
  it("downloads a message's files[] and folds the manifest into the body BEFORE the L3 handoff", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "slack-transport-media-"));
    const seen: ChannelInboundEvent[] = [];
    const mediaFetch = (async (
      _url: string | URL | Request,
      _init?: RequestInit,
    ) =>
      new Response("img-bytes", {
        status: 200,
      })) as unknown as typeof globalThis.fetch;
    const { client } = makeMediaTransport(
      async (event) => {
        seen.push(event);
      },
      { downloadDir: dir, fetchImpl: mediaFetch },
    );
    client.emit("message", {
      ack: async () => {},
      envelope_id: "env-media-1",
      body: {
        type: "message",
        user: "U0BOB",
        text: "<@U_BOT> look at this",
        ts: "1700.0001",
        channel: "C1",
        channel_type: "channel",
        event_ts: "1700.0000",
        files: [
          {
            name: "shot.png",
            mimetype: "image/png",
            url_private_download: "https://files.slack.com/shot.png",
          },
        ],
      },
      event: {
        type: "message",
        user: "U0BOB",
        text: "<@U_BOT> look at this",
        ts: "1700.0001",
        channel: "C1",
        channel_type: "channel",
        event_ts: "1700.0000",
        files: [
          {
            name: "shot.png",
            mimetype: "image/png",
            url_private_download: "https://files.slack.com/shot.png",
          },
        ],
      },
    } as never);
    await waitUntil(() => seen.length === 1);
    expect(seen).toHaveLength(1);
    // The L3 sees the FINAL body (text + manifest), not the raw text.
    assert.equal(
      seen[0]?.body,
      `<@U_BOT> look at this\n\n[Attached files]\n` +
        `1. shot.png (image, 9 bytes) → ${join(dir, "1700.0001-1-shot.png")}`,
    );
    const { stat } = await import("node:fs/promises");
    await stat(join(dir, "1700.0001-1-shot.png"));
    await rm(dir, { recursive: true, force: true });
  });

  it("drops an all-files-failed media-only event (never reaches the L3)", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "slack-transport-mediafail-"));
    const seen: ChannelInboundEvent[] = [];
    const failingFetch = (async () =>
      new Response("gone", {
        status: 404,
      })) as unknown as typeof globalThis.fetch;
    const { client } = makeMediaTransport(
      async (event) => {
        seen.push(event);
      },
      { downloadDir: dir, fetchImpl: failingFetch },
    );
    client.emit("message", {
      ack: async () => {},
      envelope_id: "env-media-2",
      body: {
        type: "message",
        user: "U0BOB",
        ts: "1700.0002",
        channel: "C1",
        channel_type: "channel",
        event_ts: "1700.0000",
        files: [
          {
            name: "x.png",
            mimetype: "image/png",
            url_private_download: "https://files.slack.com/x",
          },
        ],
      },
      event: {
        type: "message",
        user: "U0BOB",
        ts: "1700.0002",
        channel: "C1",
        channel_type: "channel",
        event_ts: "1700.0000",
        files: [
          {
            name: "x.png",
            mimetype: "image/png",
            url_private_download: "https://files.slack.com/x",
          },
        ],
      },
    } as never);
    // Let the download fail + the fold settle, then assert the event never
    // reached the L3 (a bare `setTimeout(0)` cannot prove a negative).
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(seen).toHaveLength(0);
    await rm(dir, { recursive: true, force: true });
  });
});

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
