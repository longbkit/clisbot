// The Fusion inbound contract on the Bolt provider (slice 21). The Bolt `App`
// here is the REAL one — only the Socket Mode receiver is faked, so the ack
// ordering under test is Bolt's own listener/ack machinery, not a stand-in.
//
// The load-bearing assertion is the first one: Bolt acks Events API envelopes
// BEFORE the listener chain runs (`App.js`: "Events API requests are
// acknowledged right away"), so without the `ingress.ts` receiver wrapper this
// provider would ack before the Hub admitted anything.

import { App, HTTPReceiver } from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelInboundEvent } from "@getpaseo/channels-shared";
import { createSlackBoltProvider, type SlackBoltProviderOptions } from "./provider.js";

type ProcessEventShim = (event: {
  body: Record<string, unknown>;
  ack: (response?: unknown) => Promise<void>;
  retryNum?: number;
  retryReason?: string;
}) => Promise<void>;

/** A Socket Mode receiver stand-in: captures the app shim Bolt/the wrapper
 * installs, and lets a test push one envelope through it. */
class FakeSocketModeReceiver {
  static latest: FakeSocketModeReceiver | undefined;
  shim: { processEvent: ProcessEventShim } | undefined;
  started = 0;
  stopped = 0;
  /** The SDK's `SocketModeClient`, as far as the shutdown path is concerned:
   * its patched reconnect scheduler stands down only when `shuttingDown` is
   * set (`provider-support.ts`). */
  client = { shuttingDown: false };

  /** What the SDK's reconnect timer decides when it fires. */
  wouldReconnect(): boolean {
    return !this.client.shuttingDown;
  }

  constructor(public options: Record<string, unknown>) {
    FakeSocketModeReceiver.latest = this;
  }

  init(app: { processEvent: ProcessEventShim }): void {
    this.shim = app;
  }

  async start(): Promise<void> {
    this.started += 1;
  }

  async stop(): Promise<void> {
    this.stopped += 1;
  }

  /** Deliver one Socket Mode envelope; resolves with the ack calls it made. */
  async deliver(body: Record<string, unknown>): Promise<{ acks: unknown[] }> {
    const acks: unknown[] = [];
    await this.shim?.processEvent({
      body,
      ack: async (response?: unknown) => {
        acks.push(response ?? null);
      },
    });
    return { acks };
  }
}

function eventEnvelope(event: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    team_id: "T1",
    api_app_id: "A1",
    event_id: `Ev${Math.random().toString(36).slice(2)}`,
    event,
    ...overrides,
  };
}

function makeProvider(overrides: Partial<SlackBoltProviderOptions> = {}) {
  const admitted: ChannelInboundEvent[] = [];
  const controller = new AbortController();
  const provider = createSlackBoltProvider({
    botToken: "xoxb-test",
    appToken: "xapp-test",
    identity: { botUserId: "U_BOT", botId: "B_BOT", teamId: "T1", apiAppId: "A1" },
    onInbound: async (event) => {
      admitted.push(event);
    },
    abortSignal: controller.signal,
    interop: {
      App,
      HTTPReceiver,
      SocketModeReceiver: FakeSocketModeReceiver as never,
    },
    ...overrides,
  });
  // `start()` never resolves until the account aborts; the receiver is created
  // and wired synchronously enough that awaiting a macrotask is sufficient.
  const running = provider.start();
  return {
    admitted,
    controller,
    running,
    async ready(): Promise<FakeSocketModeReceiver> {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const receiver = FakeSocketModeReceiver.latest;
      if (receiver === undefined) throw new Error("receiver not constructed");
      return receiver;
    },
    async shutdown(): Promise<void> {
      controller.abort();
      await running.catch(() => undefined);
    },
  };
}

beforeEach(() => {
  FakeSocketModeReceiver.latest = undefined;
});

describe("slack bolt provider: ack after admission", () => {
  it("does not ack until the Hub handoff resolved", async () => {
    const order: string[] = [];
    let releaseHandoff: (() => void) | undefined;
    const harness = makeProvider({
      onInbound: async () => {
        order.push("admit:start");
        await new Promise<void>((resolve) => {
          releaseHandoff = resolve;
        });
        order.push("admit:done");
      },
    });
    const receiver = await harness.ready();
    const delivery = receiver.deliver(
      eventEnvelope({
        type: "message",
        channel: "C1",
        channel_type: "channel",
        user: "U_HUMAN",
        text: "<@U_BOT> hi",
        ts: "1700.000100",
        event_ts: "1700.000100",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The listener is parked inside the handoff — Bolt already ran its eager
    // ack, but the wrapper deferred it.
    expect(order).toEqual(["admit:start"]);
    releaseHandoff?.();
    const { acks } = await delivery;
    expect(order).toEqual(["admit:start", "admit:done"]);
    expect(acks).toHaveLength(1);
    await harness.shutdown();
  });

  it("never acks when the Hub handoff fails, so Slack redelivers", async () => {
    const harness = makeProvider({
      onInbound: async () => {
        throw new Error("queue write failed");
      },
    });
    const receiver = await harness.ready();
    await expect(
      receiver.deliver(
        eventEnvelope({
          type: "message",
          channel: "C1",
          channel_type: "channel",
          user: "U_HUMAN",
          text: "<@U_BOT> hi",
          ts: "1700.000101",
          event_ts: "1700.000101",
        }),
      ),
    ).rejects.toThrow(/queue write failed/);
    await harness.shutdown();
  });

  it("drops an envelope from another workspace before admission", async () => {
    const harness = makeProvider();
    const receiver = await harness.ready();
    const { acks } = await receiver.deliver(
      eventEnvelope(
        {
          type: "message",
          channel: "C1",
          channel_type: "channel",
          user: "U_HUMAN",
          text: "<@U_BOT> hi",
          ts: "1700.000102",
          event_ts: "1700.000102",
        },
        { team_id: "T_OTHER" },
      ),
    );
    expect(harness.admitted).toHaveLength(0);
    // A mismatched envelope is still acked: it is not this account's traffic
    // and redelivering it forever would stall the socket.
    expect(acks).toHaveLength(1);
    await harness.shutdown();
  });
});

describe("slack bolt provider: stopping", () => {
  // The abort is the only stop an account gets. Bolt's socket client reconnects
  // on its own schedule and stands down only once `shuttingDown` is set, which
  // used to happen in the provider's `finally` — after the disconnect await —
  // so a stopping account could reconnect and keep consuming events (D-042).
  it("stands the socket's reconnect scheduler down as the abort fires", async () => {
    const harness = makeProvider();
    const receiver = await harness.ready();
    expect(receiver.wouldReconnect()).toBe(true);

    harness.controller.abort();
    // Synchronously with the abort, before anything is awaited: a reconnect
    // timer firing in this window finds the client already shutting down.
    expect(receiver.client.shuttingDown).toBe(true);
    expect(receiver.wouldReconnect()).toBe(false);

    await harness.running.catch(() => undefined);
    expect(receiver.stopped).toBe(1);
  });
});

describe("slack bolt provider: message families", () => {
  it("admits a mentioned channel message with the conversation as the reply target", async () => {
    const harness = makeProvider();
    const receiver = await harness.ready();
    await receiver.deliver(
      eventEnvelope({
        type: "message",
        channel: "C1",
        channel_type: "channel",
        user: "U_HUMAN",
        text: "<@U_BOT> ship it",
        ts: "1700.000200",
        event_ts: "1700.000200",
        thread_ts: "1700.000100",
      }),
    );
    expect(harness.admitted).toHaveLength(1);
    expect(harness.admitted[0]).toMatchObject({
      channel: "slack",
      externalConversationId: "C1",
      externalMessageId: "1700.000200",
      messageThreadId: "1700.000100",
      chatType: "channel",
      senderId: "U_HUMAN",
      wasMentioned: true,
    });
    await harness.shutdown();
  });

  it("drops the app_mention duplicate in a DM (the message event already covers it)", async () => {
    const harness = makeProvider();
    const receiver = await harness.ready();
    await receiver.deliver(
      eventEnvelope({
        type: "app_mention",
        channel: "D1",
        user: "U_HUMAN",
        text: "<@U_BOT> hi",
        ts: "1700.000300",
        event_ts: "1700.000300",
      }),
    );
    expect(harness.admitted).toHaveLength(0);
    await harness.shutdown();
  });

  it("admits an edit as the upstream `Slack message edited` notification", async () => {
    const harness = makeProvider();
    const receiver = await harness.ready();
    await receiver.deliver(
      eventEnvelope({
        type: "message",
        subtype: "message_changed",
        channel: "C1",
        channel_type: "channel",
        event_ts: "1700.000401",
        message: { type: "message", ts: "1700.000400", user: "U_HUMAN", text: "edited" },
        previous_message: { type: "message", ts: "1700.000400", user: "U_HUMAN", text: "before" },
      }),
    );
    expect(harness.admitted).toHaveLength(1);
    expect(harness.admitted[0]?.body).toBe("Slack message edited in C1.");
    expect(harness.admitted[0]?.externalMessageId).toBe("slack:message:changed:C1:1700.000400");
    expect(harness.admitted[0]?.wasMentioned).toBe(false);
    await harness.shutdown();
  });

  it("admits a delete as the upstream `Slack message deleted` notification", async () => {
    const harness = makeProvider();
    const receiver = await harness.ready();
    await receiver.deliver(
      eventEnvelope({
        type: "message",
        subtype: "message_deleted",
        channel: "C1",
        channel_type: "channel",
        event_ts: "1700.000501",
        deleted_ts: "1700.000500",
        previous_message: { type: "message", ts: "1700.000500", user: "U_HUMAN", text: "gone" },
      }),
    );
    expect(harness.admitted[0]?.body).toBe("Slack message deleted in C1.");
    expect(harness.admitted[0]?.externalMessageId).toBe("slack:message:deleted:C1:1700.000500");
    await harness.shutdown();
  });

  it("admits reaction_added / reaction_removed with the upstream text", async () => {
    const harness = makeProvider();
    const receiver = await harness.ready();
    for (const [type, action] of [
      ["reaction_added", "added"],
      ["reaction_removed", "removed"],
    ] as const) {
      await receiver.deliver(
        eventEnvelope(
          {
            type,
            user: "U_HUMAN",
            reaction: "eyes",
            item_user: "U_BOT",
            item: { type: "message", channel: "C1", ts: "1700.000600" },
            event_ts: "1700.000601",
          },
          { event_id: `Ev-${action}` },
        ),
      );
    }
    expect(harness.admitted.map((event) => event.body)).toEqual([
      "Slack reaction added: :eyes: by U_HUMAN in C1 msg 1700.000600 from U_BOT",
      "Slack reaction removed: :eyes: by U_HUMAN in C1 msg 1700.000600 from U_BOT",
    ]);
    expect(harness.admitted[0]?.externalMessageId).toBe(
      "slack:reaction:T1:added:C1:1700.000600:U_HUMAN:eyes:Ev-added",
    );
    await harness.shutdown();
  });

  it("admits member join/leave with the upstream text", async () => {
    const harness = makeProvider();
    const receiver = await harness.ready();
    await receiver.deliver(
      eventEnvelope(
        {
          type: "member_joined_channel",
          user: "U_HUMAN",
          channel: "C1",
          channel_type: "C",
          event_ts: "1700.000700",
        },
        { event_id: "Ev-join" },
      ),
    );
    expect(harness.admitted[0]?.body).toBe("Slack: U_HUMAN joined C1.");
    expect(harness.admitted[0]?.externalMessageId).toBe(
      "slack:member:T1:joined:C1:U_HUMAN:Ev-join",
    );
    await harness.shutdown();
  });

  it("downloads every file on a multi-file message before admission", async () => {
    const downloads: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown) => {
      downloads.push(String(url));
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const harness = makeProvider({
      media: {
        accountId: "acct",
        downloadDir: `${process.env.TMPDIR ?? "/tmp"}/slack-provider-media-${Date.now()}`,
        fetchImpl,
      },
    });
    const receiver = await harness.ready();
    await receiver.deliver(
      eventEnvelope({
        type: "message",
        channel: "C1",
        channel_type: "channel",
        user: "U_HUMAN",
        text: "<@U_BOT> look",
        ts: "1700.000800",
        event_ts: "1700.000800",
        files: [
          {
            id: "F1",
            name: "one.png",
            mimetype: "image/png",
            url_private_download: "https://files.slack.com/one.png",
          },
          {
            id: "F2",
            name: "two.pdf",
            mimetype: "application/pdf",
            url_private_download: "https://files.slack.com/two.pdf",
          },
        ],
      }),
    );
    expect(downloads).toEqual([
      "https://files.slack.com/one.png",
      "https://files.slack.com/two.pdf",
    ]);
    expect(harness.admitted).toHaveLength(1);
    expect(harness.admitted[0]?.body).toContain("[Attached files]");
    expect(harness.admitted[0]?.body).toContain("one.png");
    expect(harness.admitted[0]?.body).toContain("two.pdf");
    await harness.shutdown();
  });
});

describe("slack bolt provider: slash commands and interactive payloads", () => {
  it("acks a slash command first, then admits the rewritten text command", async () => {
    const order: string[] = [];
    const harness = makeProvider({
      slashCommand: "/paseo",
      onInbound: async () => {
        order.push("admit");
      },
    });
    const receiver = await harness.ready();
    const acks: unknown[] = [];
    await receiver.shim?.processEvent({
      body: {
        command: "/paseo",
        text: "status",
        user_id: "U_HUMAN",
        channel_id: "C1",
        trigger_id: "TRG1",
        team_id: "T1",
        api_app_id: "A1",
      },
      ack: async (response?: unknown) => {
        order.push("ack");
        acks.push(response ?? null);
      },
    });
    expect(order).toEqual(["ack", "admit"]);
    expect(acks).toHaveLength(1);
    await harness.shutdown();
  });

  it("acks a button click immediately and admits the callback authority facts", async () => {
    const order: string[] = [];
    const interactive: Record<string, unknown>[] = [];
    const admitted: ChannelInboundEvent[] = [];
    const harness = makeProvider({
      onInteractive: async (body) => {
        order.push("approval-seam");
        interactive.push(body);
      },
      onInbound: async (event) => {
        order.push("admit");
        admitted.push(event);
      },
    });
    const receiver = await harness.ready();
    await receiver.shim?.processEvent({
      body: {
        type: "block_actions",
        team: { id: "T1" },
        api_app_id: "A1",
        user: { id: "U_APPROVER" },
        channel: { id: "C1" },
        container: { type: "message", message_ts: "1700.000900", channel_id: "C1" },
        message: { ts: "1700.000900", thread_ts: "1700.000800" },
        trigger_id: "TRG2",
        actions: [
          { action_id: "approval_allow", block_id: "b1", type: "button", value: "allow:req-1" },
        ],
      },
      ack: async () => {
        order.push("ack");
      },
    });
    expect(order).toEqual(["ack", "approval-seam", "admit"]);
    expect(interactive).toHaveLength(1);
    expect(admitted).toHaveLength(1);
    expect(admitted[0]).toMatchObject({
      channel: "slack",
      externalConversationId: "C1",
      externalMessageId: "slack:interactive:block_actions:C1:1700.000900:approval_allow:U_APPROVER",
      messageThreadId: "1700.000800",
      senderId: "U_APPROVER",
      wasMentioned: true,
    });
    expect(admitted[0]?.body).toContain("approval_allow");
    expect(admitted[0]?.body).toContain("allow:req-1");
    await harness.shutdown();
  });

  it("keeps the socket alive when the interactive admission faults", async () => {
    const harness = makeProvider({
      onInbound: async () => {
        throw new Error("queue write failed");
      },
    });
    const receiver = await harness.ready();
    let acked = false;
    await receiver.shim?.processEvent({
      body: {
        type: "block_actions",
        team: { id: "T1" },
        api_app_id: "A1",
        user: { id: "U_APPROVER" },
        channel: { id: "C1" },
        message: { ts: "1700.001000" },
        actions: [{ action_id: "a1", type: "button", value: "v" }],
      },
      ack: async () => {
        acked = true;
      },
    });
    // Interactive payloads are the documented ack-first exception; the fault is
    // logged and swallowed so the socket stays up.
    expect(acked).toBe(true);
    await harness.shutdown();
  });
});
