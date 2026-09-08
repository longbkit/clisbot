// Fusion test: the L2 gateway transport's normalizer and the L3 admission path.
//
// Discord's gateway has no ACK and no cursor, so the reliability contract the
// goal ledger asks for lands on the queue's dedupe key: a RESUME redelivery of
// the same message id must NOT reach the Hub twice. These cases drive the shared
// monitor with a fake `InboundQueueSink`, so they assert the real production
// path (`createInboundEventProcessor`), not a local stub of it.
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type {
  HostRuntime,
  InboundQueueSink,
  KeyedStoreEntry,
} from "@getpaseo/channels-shared";
import { createInboundEventProcessor } from "@getpaseo/channels-shared";
import { Client } from "../internal/client.js";
import type { DiscordMessageDispatchData } from "../internal/listeners.js";
import { Guild, Message, User } from "../internal/structures.js";
import { assertNoDuplicateDiscordTokens } from "../lifecycle/start-account.js";
import {
  normalizeDiscordMessage,
  resolveDiscordGatewayIntents,
  runDiscordGateway,
} from "./gateway.js";

const BOT_ID = "900000000000000001";

function structureClient(): Client {
  return new Client(
    {
      baseUrl: "",
      clientId: "111111111111111111",
      publicKey: "",
      token: "test-token",
      autoDeploy: false,
      disableDeployRoute: true,
      disableInteractionsRoute: true,
      disableEventsRoute: true,
    },
    {},
  );
}

/** A MESSAGE_CREATE dispatch shaped like `internal/gateway-dispatch.ts` builds it. */
function dispatch(
  overrides: {
    id?: string;
    channelId?: string;
    guildId?: string;
    authorId?: string;
    authorBot?: boolean;
    content?: string;
    mentions?: Array<{ id: string }>;
    nick?: string;
  } = {},
): DiscordMessageDispatchData {
  const client = structureClient();
  const author = {
    id: overrides.authorId ?? "200000000000000002",
    username: "alice",
    global_name: "Alice",
    discriminator: "0",
    avatar: null,
    ...(overrides.authorBot === undefined ? {} : { bot: overrides.authorBot }),
  };
  const raw = {
    id: overrides.id ?? "300000000000000003",
    channel_id: overrides.channelId ?? "400000000000000004",
    ...(overrides.guildId === undefined ? {} : { guild_id: overrides.guildId }),
    author,
    content: overrides.content ?? "hello there",
    timestamp: "2026-09-07T10:00:00.000Z",
    mentions: overrides.mentions ?? [],
    mention_roles: [],
    mention_everyone: false,
    attachments: [],
    embeds: [],
    type: 0,
    pinned: false,
    tts: false,
  };
  return {
    id: raw.id,
    channel_id: raw.channel_id,
    channelId: raw.channel_id,
    ...(overrides.guildId === undefined ? {} : { guild_id: overrides.guildId }),
    message: new Message(client, raw as never),
    author: new User(client, author as never),
    ...(overrides.nick === undefined ? {} : { member: { nick: overrides.nick } }),
    ...(overrides.guildId === undefined
      ? {}
      : { guild: new Guild(client, { id: overrides.guildId, name: "Test Guild" } as never) }),
  } as DiscordMessageDispatchData;
}

/** A queue sink that records admissions and dedupes on the external event id. */
function createFakeQueue() {
  const admitted = new Map<string, unknown>();
  const calls: Array<Parameters<InboundQueueSink["enqueue"]>[0]> = [];
  const sink: InboundQueueSink = {
    enqueue: async (params) => {
      calls.push(params);
      const key = `${params.channel}:${params.accountId}:${params.externalEventId}`;
      if (admitted.has(key)) return { created: false, id: key };
      admitted.set(key, params.payload);
      return { created: true, id: key };
    },
    claim: async () => undefined,
    complete: async () => undefined,
    fail: async () => undefined,
  };
  return { sink, calls, admitted };
}

function hostRuntime(queue?: InboundQueueSink, onInboundReply = vi.fn()): HostRuntime {
  return {
    onInboundReply: async (params) => {
      onInboundReply(params);
      return { dispatched: true };
    },
    state: {
      openKeyedStore: () => ({
        register: async () => undefined,
        registerIfAbsent: async () => true,
        update: async () => true,
        lookup: async () => undefined,
        consume: async () => undefined,
        delete: async () => false,
        entries: async () => [] as KeyedStoreEntry<unknown>[],
        clear: async () => undefined,
      }),
    },
    logging: { getChildLogger: () => ({ warn: () => undefined }) },
    channel: {},
    ...(queue === undefined ? {} : { inboundQueue: queue }),
  };
}

describe("resolveDiscordGatewayIntents", () => {
  it("requests message content by default and no privileged extras", () => {
    const intents = resolveDiscordGatewayIntents();
    // MESSAGE_CONTENT (1 << 15) on; GUILD_PRESENCES (1 << 8) and GUILD_MEMBERS
    // (1 << 1) stay off until the operator opts in.
    expect(intents & (1 << 15)).toBeTruthy();
    expect(intents & (1 << 8)).toBe(0);
    expect(intents & (1 << 1)).toBe(0);
  });

  it("drops message content and adds privileged intents on request", () => {
    const intents = resolveDiscordGatewayIntents({
      intentsConfig: { messageContent: false, presence: true, guildMembers: true },
    });
    expect(intents & (1 << 15)).toBe(0);
    expect(intents & (1 << 8)).toBeTruthy();
    expect(intents & (1 << 1)).toBeTruthy();
  });
});

describe("normalizeDiscordMessage", () => {
  it("normalizes a guild message and reports the mention fact", () => {
    const event = normalizeDiscordMessage({
      data: dispatch({ guildId: "500000000000000005", mentions: [{ id: BOT_ID }], nick: "Ali" }),
      accountId: "main",
      botId: BOT_ID,
    });
    expect(event).toMatchObject({
      channel: "discord",
      externalEventId: "300000000000000003",
      externalMessageId: "300000000000000003",
      externalConversationId: "400000000000000004",
      chatType: "channel",
      senderId: "200000000000000002",
      senderName: "Ali",
      senderUsername: "alice",
      body: "hello there",
      wasMentioned: true,
      conversationLabel: "Test Guild",
      isOwnMessage: false,
    });
    expect(event?.timestampMs).toBe(Date.parse("2026-09-07T10:00:00.000Z"));
  });

  it("treats an unmentioned guild message as not addressed", () => {
    const event = normalizeDiscordMessage({
      data: dispatch({ guildId: "500000000000000005" }),
      accountId: "main",
      botId: BOT_ID,
    });
    expect(event?.wasMentioned).toBe(false);
  });

  it("treats a DM as always addressed to the bot", () => {
    const event = normalizeDiscordMessage({
      data: dispatch(),
      accountId: "main",
      botId: BOT_ID,
    });
    expect(event?.chatType).toBe("direct");
    expect(event?.wasMentioned).toBe(true);
  });

  it("flags the bot's own message and any other bot author", () => {
    expect(
      normalizeDiscordMessage({
        data: dispatch({ authorId: BOT_ID }),
        accountId: "main",
        botId: BOT_ID,
      })?.isOwnMessage,
    ).toBe(true);
    expect(
      normalizeDiscordMessage({
        data: dispatch({ authorBot: true }),
        accountId: "main",
        botId: BOT_ID,
      })?.isOwnMessage,
    ).toBe(true);
  });
});

describe("inbound admission through the shared monitor", () => {
  it("admits a first-sight message to the durable queue before any handoff", async () => {
    const queue = createFakeQueue();
    const onInboundReply = vi.fn();
    const processor = createInboundEventProcessor({
      hostRuntime: hostRuntime(queue.sink, onInboundReply),
      channel: "discord",
      accountId: "main",
      botId: BOT_ID,
    });
    const event = normalizeDiscordMessage({
      data: dispatch({ guildId: "500000000000000005" }),
      accountId: "main",
      botId: BOT_ID,
    });
    const decision = await processor.process(event!);
    expect(decision).toEqual({ dispatched: true, reason: "queued" });
    expect(queue.calls).toHaveLength(1);
    expect(queue.calls[0]).toMatchObject({
      channel: "discord",
      accountId: "main",
      externalMessageId: "300000000000000003",
      externalConversationId: "400000000000000004",
      laneKey: "discord:main:400000000000000004:root",
    });
    // Admission is the boundary: the drain, not the transport, hands the payload on.
    expect(onInboundReply).not.toHaveBeenCalled();
  });

  it("drops a RESUME redelivery of the same message id (queue dedupe key)", async () => {
    const queue = createFakeQueue();
    const runtime = hostRuntime(queue.sink);
    const event = normalizeDiscordMessage({
      data: dispatch({ guildId: "500000000000000005" }),
      accountId: "main",
      botId: BOT_ID,
    })!;
    // A resumed session replays the dispatch into a NEW processor (the socket
    // reconnected), so the in-flight set cannot be what dedupes it.
    const first = await createInboundEventProcessor({
      hostRuntime: runtime,
      channel: "discord",
      accountId: "main",
      botId: BOT_ID,
    }).process(event);
    const second = await createInboundEventProcessor({
      hostRuntime: runtime,
      channel: "discord",
      accountId: "main",
      botId: BOT_ID,
    }).process(event);
    expect(first.dispatched).toBe(true);
    expect(second).toEqual({ dispatched: false, reason: "queue replay" });
    expect(queue.admitted.size).toBe(1);
  });

  it("never admits the bot's own message", async () => {
    const queue = createFakeQueue();
    const processor = createInboundEventProcessor({
      hostRuntime: hostRuntime(queue.sink),
      channel: "discord",
      accountId: "main",
      botId: BOT_ID,
    });
    const event = normalizeDiscordMessage({
      data: dispatch({ authorId: BOT_ID, guildId: "500000000000000005" }),
      accountId: "main",
      botId: BOT_ID,
    })!;
    expect(await processor.process(event)).toEqual({
      dispatched: false,
      reason: "own message",
    });
    expect(queue.calls).toHaveLength(0);
  });

  it("keys the lane on the thread when the message sits in one", async () => {
    const queue = createFakeQueue();
    const processor = createInboundEventProcessor({
      hostRuntime: hostRuntime(queue.sink),
      channel: "discord",
      accountId: "main",
      botId: BOT_ID,
    });
    const event = normalizeDiscordMessage({
      data: dispatch({ guildId: "500000000000000005" }),
      accountId: "main",
      botId: BOT_ID,
    })!;
    // A Discord thread IS a channel; the normalizer reports it as the thread id
    // when the message's own channel differs from its parent.
    await processor.process({ ...event, messageThreadId: "600000000000000006" });
    expect(queue.calls[0]).toMatchObject({
      externalThreadId: "600000000000000006",
      laneKey: "discord:main:400000000000000004:600000000000000006",
    });
  });
});

/** A `ws`-shaped socket the ported gateway drives, with no network behind it. */
class FakeGatewaySocket extends EventEmitter {
  static last: FakeGatewaySocket | undefined;
  binaryType = "nodebuffer";
  readyState = 1;
  constructor(readonly url: string) {
    super();
    FakeGatewaySocket.last = this;
  }
  send(): void {}
  close(): void {}
  terminate(): void {}
}

describe("gateway faults", () => {
  it("parks the account instead of crashing the process on a fatal close code", async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown): void => void uncaught.push(error);
    process.once("uncaughtException", onUncaught);
    const warned: unknown[][] = [];
    const controller = new AbortController();
    const run = runDiscordGateway({
      accountId: "main",
      token: "test-token",
      botId: BOT_ID,
      applicationId: "111111111111111111",
      intents: 0,
      abortSignal: controller.signal,
      webSocketCtor: FakeGatewaySocket as unknown as typeof import("ws").WebSocket,
      logger: {
        warn: (...args: unknown[]) => void warned.push(args),
        error: (...args: unknown[]) => void warned.push(args),
      } as never,
      onEvent: async () => undefined,
    });
    const socket = FakeGatewaySocket.last!;
    // A recoverable fault first: the transport keeps running.
    socket.emit("error", new Error("read ECONNRESET"));
    // 4004 = authentication failed. `internal/gateway.ts` clears
    // `shouldReconnect` and emits "error"; with no subscriber node would rethrow
    // it as an uncaught exception and take the Hub down.
    socket.emit("close", 4004);
    const outcome = await run;

    expect(outcome).toEqual({ stopped: "error", reason: "Fatal gateway close code: 4004" });
    expect(uncaught).toEqual([]);
    process.off("uncaughtException", onUncaught);
    controller.abort();
  });

  it("resolves as a clean stop when the account is aborted", async () => {
    const controller = new AbortController();
    const run = runDiscordGateway({
      accountId: "main",
      token: "test-token",
      botId: BOT_ID,
      applicationId: "111111111111111111",
      intents: 0,
      abortSignal: controller.signal,
      webSocketCtor: FakeGatewaySocket as unknown as typeof import("ws").WebSocket,
      onEvent: async () => undefined,
    });
    controller.abort();
    expect(await run).toEqual({ stopped: "abort" });
  });
});

describe("assertNoDuplicateDiscordTokens", () => {
  it("refuses a token shared by two accounts that are not the first one", () => {
    const cfg = {
      channels: {
        discord: {
          accounts: {
            a: { token: "token-x" },
            b: { token: "token-y" },
            c: { token: "token-y" },
          },
        },
      },
    } as never;
    expect(() => assertNoDuplicateDiscordTokens(cfg, "c")).toThrow(/"b" and "c"/);
  });

  it("accepts distinct tokens and ignores blank ones", () => {
    const cfg = {
      channels: {
        discord: { accounts: { a: { token: "token-x" }, b: { token: "  " }, c: { token: "" } } },
      },
    } as never;
    expect(() => assertNoDuplicateDiscordTokens(cfg, "a")).not.toThrow();
  });
});
