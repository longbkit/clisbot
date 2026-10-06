import type { WAMessage } from "baileys";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const socket = vi.hoisted(() => ({
  upsert: undefined as undefined | ((upsert: { type?: string; messages?: WAMessage[] }) => void),
  markRead: vi.fn(async () => {}),
  connectedAtMs: Date.now(),
}));
vi.mock("../inbound/socket-session.js", () => ({
  createWhatsAppAttachedSocketSession: async () => ({
    connectedAtMs: socket.connectedAtMs,
    self: { jid: "15550001111@s.whatsapp.net", lid: null, e164: "+15550001111" },
    getCurrentSock: () => null,
    resolveInboundJid: async (jid: string) => jid,
    rememberBaileysMessage: () => {},
    markRead: socket.markRead,
    listen: (_event: string, handler: NonNullable<typeof socket.upsert>) => {
      socket.upsert = handler;
      return () => {
        socket.upsert = undefined;
      };
    },
    start: () => {},
    stop: () => {},
    closeSocket: () => {},
    onClose: new Promise(() => {}),
    signalClose: () => {},
    assertSendReady: async () => {},
    socketOperations: {},
  }),
}));
vi.mock("../inbound/group-metadata-cache.js", () => ({
  createWhatsAppGroupMetadataCacheOwner: () => ({ start: () => {}, close: () => {}, resolveOutboundMentions: async () => ({}) }),
}));
vi.mock("../inbound/send-api.js", () => ({
  createWebSendApi: () => ({ sendComposingTo: vi.fn(), sendMessage: vi.fn(), sendPoll: vi.fn(), sendReaction: vi.fn() }),
}));
vi.mock("../inbound/message-normalization.js", () => ({
  createWhatsAppInboundMessageNormalizer: () => ({
    normalize: async (msg: WAMessage) => ({
      id: msg.key?.id,
      remoteJid: msg.key?.remoteJid,
      group: false,
      from: "+15557778888",
      senderE164: "+15557778888",
      access: { allowed: true, isSelfChat: msg.key?.remoteJid === "self@s.whatsapp.net" },
    }),
  }),
}));
vi.mock("../inbound/message-enrichment.js", () => ({
  enrichWhatsAppInboundMessage: async ({ msg }: { msg: WAMessage }) => ({
    body: msg.message?.conversation ?? "",
    commandBody: msg.message?.conversation ?? "",
    ...(msg.message?.conversation?.startsWith("re:") ? { replyContext: { body: "earlier" } } : {}),
  }),
}));

const { attachWhatsAppInbox, WHATSAPP_ADMISSION_MAX_ATTEMPTS } = await import("./inbox.js");
const { takeWhatsAppQuote } = await import("./quotes.js");
const { lookupInboundMessageMeta } = await import("../quoted-message.js");
const { openWhatsAppPollStore } = await import("./polls.js");
const { createRecordingHostRuntime } = await import("./test-support.js");

function message(id: string, text: string, opts: { remoteJid?: string; secondsAgo?: number } = {}): WAMessage {
  return {
    key: { id, remoteJid: opts.remoteJid ?? "15557778888@s.whatsapp.net" },
    message: { conversation: text },
    messageTimestamp: Math.floor(Date.now() / 1000) - (opts.secondsAgo ?? 0),
  } as WAMessage;
}

async function attach(
  admit: (event: { externalMessageId: string; body: string; kind?: string }) => Promise<unknown>,
  extra: { polls?: ReturnType<typeof openWhatsAppPollStore> } = {},
) {
  const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const listener = await attachWhatsAppInbox({
    cfg: {} as never,
    accountId: "a",
    authDir: "/virtual",
    sock: {} as never,
    socketRef: { current: null },
    socketTiming: {} as never,
    shouldRetryDisconnect: () => false,
    disconnectRetryPolicy: { initialMs: 1, maxMs: 1, factor: 1, jitter: 0, maxAttempts: 1 },
    disconnectRetryAbortSignal: new AbortController().signal,
    groupMetadataCache: new Map(),
    recentMessageKeys: new Map(),
    baileysGroupMetaCache: new Map(),
    admit: admit as never,
    ...extra,
    abortSignal: new AbortController().signal,
    logger,
  });
  return { listener, logger };
}

async function settle(listener: { close?: () => Promise<void> }) {
  await listener.close?.();
}

describe("fusion inbox (push-family admission)", () => {
  beforeEach(() => {
    socket.markRead.mockClear();
    socket.connectedAtMs = Date.now();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("admits a chat's messages in arrival order, then sends each read receipt", async () => {
    const admitted: string[] = [];
    const { listener } = await attach(async (event) => {
      admitted.push(event.body);
    });
    socket.upsert?.({ type: "notify", messages: [message("1", "first"), message("2", "second")] });
    socket.upsert?.({ type: "notify", messages: [message("3", "third")] });
    await settle(listener);
    expect(admitted).toEqual(["first", "second", "third"]);
    expect(socket.markRead).toHaveBeenCalledTimes(3);
  });

  it("retries a failed admission in place and reads the message once it is stored", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { listener } = await attach(async () => {
      calls += 1;
      if (calls === 1) throw new Error("queue unavailable");
    });
    socket.upsert?.({ type: "notify", messages: [message("1", "hello")] });
    await vi.advanceTimersByTimeAsync(2_000);
    await settle(listener);
    expect(calls).toBe(2);
    expect(socket.markRead).toHaveBeenCalledTimes(1);
  });

  it("drops loudly, and never marks read, once the admission budget is spent", async () => {
    vi.useFakeTimers();
    const admit = vi.fn(async () => {
      throw new Error("queue unavailable");
    });
    const { listener, logger } = await attach(admit);
    socket.upsert?.({ type: "notify", messages: [message("9", "lost")] });
    await vi.advanceTimersByTimeAsync(30_000);
    await settle(listener);
    expect(admit).toHaveBeenCalledTimes(WHATSAPP_ADMISSION_MAX_ATTEMPTS);
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/dropped after 5 admission attempts/));
    expect(socket.markRead).not.toHaveBeenCalled();
  });

  it("skips reconnect catch-up older than the grace window and receipts nothing in self-chat", async () => {
    const admitted: string[] = [];
    const { listener } = await attach(async (event) => {
      admitted.push(event.body);
    });
    socket.upsert?.({ type: "append", messages: [message("old", "stale", { secondsAgo: 3600 })] });
    socket.upsert?.({ type: "notify", messages: [message("s", "note to self", { remoteJid: "self@s.whatsapp.net" })] });
    await settle(listener);
    expect(admitted).toEqual(["note to self"]);
    expect(socket.markRead).not.toHaveBeenCalled();
  });

  it("fills upstream's quote cache and remembers the chat's latest message to quote", async () => {
    const { listener } = await attach(async () => {});
    socket.upsert?.({ type: "notify", messages: [message("Q1", "re: yes that one"), message("Q2", "plain")] });
    await settle(listener);
    expect(lookupInboundMessageMeta("a", "15557778888@s.whatsapp.net", "Q1")?.body).toBe("re: yes that one");
    expect(takeWhatsAppQuote("a", "15557778888@s.whatsapp.net")).toBe("Q2");
  });

  it("routes a poll vote to poll intake instead of the message path", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    const admitted: string[] = [];
    const { listener, logger } = await attach(
      async (event) => {
        admitted.push(event.body);
      },
      { polls: openWhatsAppPollStore(hostRuntime) },
    );
    socket.upsert?.({
      type: "notify",
      messages: [
        {
          key: { id: "V1", remoteJid: "15557778888@s.whatsapp.net" },
          message: { pollUpdateMessage: { pollCreationMessageKey: { id: "NOPE" }, vote: { encPayload: Buffer.alloc(16), encIv: Buffer.alloc(12) } } },
        } as WAMessage,
      ],
    });
    await settle(listener);
    expect(admitted).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/poll vote for NOPE not decoded/));
    expect(socket.markRead).not.toHaveBeenCalled();
  });
});
