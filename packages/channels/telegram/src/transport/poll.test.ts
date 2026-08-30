import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChannelInboundEvent, KeyedStoreEntry } from "@getpaseo/channels-shared";
import {
  fingerprintTelegramBotToken,
  normalizeTelegramInboundEvent,
  readUpdateOffset,
  runTelegramPoll,
  writeUpdateOffset,
  type TelegramUpdateShape,
} from "./poll.js";

/** Minimal in-memory keyed store matching the seam surface the poll uses. */
class FakeKeyedStore<T> {
  private readonly records = new Map<string, T>();
  async register(key: string, value: T): Promise<void> {
    this.records.set(key, value);
  }
  async lookup(key: string): Promise<T | undefined> {
    return this.records.get(key);
  }
  async delete(key: string): Promise<boolean> {
    return this.records.delete(key);
  }
  async registerIfAbsent(key: string, value: T): Promise<boolean> {
    if (this.records.has(key)) return false;
    this.records.set(key, value);
    return true;
  }
  async update(key: string, fn: (current: T | undefined) => T | undefined): Promise<boolean> {
    const next = fn(this.records.get(key));
    if (next === undefined) return false;
    this.records.set(key, next);
    return true;
  }
  async consume(key: string): Promise<T | undefined> {
    const value = this.records.get(key);
    this.records.delete(key);
    return value;
  }
  async entries(): Promise<KeyedStoreEntry<T>[]> {
    return [...this.records.entries()].map(([key, value]) => ({ key, value, createdAt: 0 }));
  }
  async clear(): Promise<void> {
    this.records.clear();
  }
}

interface OffsetState {
  lastUpdateId: number;
  botId: string | null;
  tokenFingerprint: string | null;
}

const BOT_TOKEN = "123456789:TEST-TOKEN";
const BOT_ID = 123456789;

const FOREIGN_BOT_ID = 987654321;

function makeUpdate(
  updateId: number,
  messageId: number,
  text: string,
  opts?: { fromBot?: boolean; fromForeignBot?: boolean },
): TelegramUpdateShape {
  const fromOwnBot = opts?.fromBot === true;
  const fromForeignBot = opts?.fromForeignBot === true;
  // own bot = the account's own bot id; foreign bot = a DIFFERENT bot
  // (e.g. the E2E master bot acting as the external sender); else human.
  let senderId = 42;
  if (fromOwnBot) senderId = BOT_ID;
  else if (fromForeignBot) senderId = FOREIGN_BOT_ID;
  const isBot = fromOwnBot || fromForeignBot;
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: 1_700_000_000,
      text,
      chat: { id: -100_000_000_001, type: "supergroup", title: "Test Group" },
      from: {
        id: senderId,
        is_bot: isBot,
        first_name: isBot ? "A Bot" : "Human",
      },
    },
  };
}

describe("telegram poll transport", () => {
  it("normalizes an update and flags own + empty-body events", () => {
    const human = normalizeTelegramInboundEvent(makeUpdate(1, 10, "hello bot"), {
      accountId: "a",
      botId: BOT_ID,
    });
    expect(human).not.toBeNull();
    expect(human?.isOwnMessage).toBe(false);
    expect(human?.externalMessageId).toBe("10");
    expect(human?.externalConversationId).toBe("-100000000001");
    expect(human?.chatType).toBe("group");
    expect(human?.body).toBe("hello bot");

    const own = normalizeTelegramInboundEvent(makeUpdate(2, 11, "my reply", { fromBot: true }), {
      accountId: "a",
      botId: BOT_ID,
    });
    expect(own?.isOwnMessage).toBe(true);

    // Regression (2026-08-26 live E2E): a DIFFERENT bot — e.g. the E2E master
    // bot playing the external sender — is a legitimate inbound sender, not an
    // own message. Flagging `is_bot` alone dropped it silently at L3.
    const foreign = normalizeTelegramInboundEvent(
      makeUpdate(3, 13, "@bot hello from another bot", { fromForeignBot: true }),
      { accountId: "a", botId: BOT_ID },
    );
    expect(foreign?.isOwnMessage).toBe(false);
    expect(foreign?.senderId).toBe(String(FOREIGN_BOT_ID));

    const empty = normalizeTelegramInboundEvent(makeUpdate(4, 14, "   "), {
      accountId: "a",
      botId: BOT_ID,
    });
    expect(empty?.body.trim()).toBe("");
  });

  it("long-polls, forwards events, persists the max offset, and stops on abort", async () => {
    const store = new FakeKeyedStore<OffsetState>();
    const controller = new AbortController();
    const seen: ChannelInboundEvent[] = [];
    let pollCalls = 0;
    await runTelegramPoll({
      accountId: "acct",
      botToken: BOT_TOKEN,
      apiRoot: "https://api.telegram.org",
      botId: BOT_ID,
      abortSignal: controller.signal,
      updateOffsetStore: store,
      onEvent: async (event) => {
        seen.push(event);
        controller.abort();
      },
      pollFn: async ({ offset }) => {
        pollCalls += 1;
        if (offset <= 0) {
          return [makeUpdate(1, 10, "hello"), makeUpdate(2, 11, "bot reply", { fromBot: true })];
        }
        return [];
      },
    });
    expect(pollCalls).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.externalMessageId).toBe("10");
    expect(seen[1]?.isOwnMessage).toBe(true);
    expect(await store.lookup("telegram")).toEqual({
      lastUpdateId: 2,
      botId: "123456789",
      tokenFingerprint: fingerprintTelegramBotToken(BOT_TOKEN),
    });
    expect(await readUpdateOffset(store, BOT_TOKEN)).toBe(2);
  });

  // --- Group G: inbound media at the poll level (download + manifest fold).

  /** A fetch that answers `getFile` (keying off the file_id in the URL) and
   * the file stream; `fileOk` controls whether the stream succeeds. */
  function mediaFetch(fileOk: boolean) {
    return (async (url: string | URL | Request) => {
      const urlText = String(url);
      if (urlText.includes("/getFile")) {
        const ok = fileOk || urlText.includes("good");
        return new Response(
          JSON.stringify({ ok: true, result: { file_path: ok ? "files/good" : "files/bad" } }),
          { status: 200 },
        );
      }
      const isBad = urlText.includes("files/bad");
      return new Response(isBad ? "gone" : "media-bytes", { status: isBad ? 404 : 200 });
    }) as unknown as typeof globalThis.fetch;
  }

  function mediaUpdate(
    updateId: number,
    messageId: number,
    extra: Partial<import("./poll.js").TelegramMessageShape>,
  ): TelegramUpdateShape {
    return {
      update_id: updateId,
      message: {
        message_id: messageId,
        date: 1_700_000_000,
        chat: { id: -100_000_000_001, type: "supergroup", title: "Test Group" },
        from: { id: 42, first_name: "Human" },
        ...extra,
      },
    };
  }

  it("folds caption + two attachments into the body, files land on disk (G1/G5)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tg-poll-media-"));
    const controller = new AbortController();
    const seen: ChannelInboundEvent[] = [];
    await runTelegramPoll({
      accountId: "acct",
      botToken: BOT_TOKEN,
      apiRoot: "https://api.telegram.org",
      botId: BOT_ID,
      abortSignal: controller.signal,
      updateOffsetStore: new FakeKeyedStore<OffsetState>(),
      downloadDir: dir,
      fetchImpl: mediaFetch(true),
      onEvent: async (event) => {
        seen.push(event);
        controller.abort();
      },
      pollFn: async () => [
        mediaUpdate(1, 30, {
          caption: "describe these",
          photo: [
            { file_id: "small", file_size: 10 },
            { file_id: "large", file_size: 90 },
          ],
          document: { file_id: "doc", file_name: "notes.txt", file_size: 11 },
        }),
      ],
    });
    expect(seen).toHaveLength(1);
    const body = seen[0]?.body;
    expect(body).toBe(
      `describe these\n\n[Attached files]\n` +
        `1. photo (photo, 11 bytes) → ${join(dir, "30-1-photo.jpg")}\n` +
        `2. notes.txt (document, 11 bytes) → ${join(dir, "30-2-notes.txt")}`,
    );
    await stat(join(dir, "30-1-photo.jpg"));
    await stat(join(dir, "30-2-notes.txt"));
    await rm(dir, { recursive: true, force: true });
  });

  it("admits a media-only message with attachments: body is the manifest alone (G6)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tg-poll-media6-"));
    const controller = new AbortController();
    const seen: ChannelInboundEvent[] = [];
    await runTelegramPoll({
      accountId: "acct",
      botToken: BOT_TOKEN,
      apiRoot: "https://api.telegram.org",
      botId: BOT_ID,
      abortSignal: controller.signal,
      updateOffsetStore: new FakeKeyedStore<OffsetState>(),
      downloadDir: dir,
      fetchImpl: mediaFetch(true),
      onEvent: async (event) => {
        seen.push(event);
        controller.abort();
      },
      pollFn: async () => [mediaUpdate(1, 31, { photo: [{ file_id: "p", file_size: 11 }] })],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.body).toBe(
      `[Attached files]\n1. photo (photo, 11 bytes) → ${join(dir, "31-1-photo.jpg")}`,
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps an attachment-less media-only event body empty (G6: L3 drops it)", async () => {
    const controller = new AbortController();
    const seen: ChannelInboundEvent[] = [];
    await runTelegramPoll({
      accountId: "acct",
      botToken: BOT_TOKEN,
      apiRoot: "https://api.telegram.org",
      botId: BOT_ID,
      abortSignal: controller.signal,
      updateOffsetStore: new FakeKeyedStore<OffsetState>(),
      // No downloadDir AND no attachments: the event body stays "".
      onEvent: async (event) => {
        seen.push(event);
        controller.abort();
      },
      pollFn: async () => [mediaUpdate(1, 32, { video: { file_id: "v" } })],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.body).toBe("");
  });

  it("hands no event when every attachment fails (G11 floor)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tg-poll-mediafail-"));
    const controller = new AbortController();
    const seen: ChannelInboundEvent[] = [];
    let polls = 0;
    await runTelegramPoll({
      accountId: "acct",
      botToken: BOT_TOKEN,
      apiRoot: "https://api.telegram.org",
      botId: BOT_ID,
      abortSignal: controller.signal,
      updateOffsetStore: new FakeKeyedStore<OffsetState>(),
      downloadDir: dir,
      fetchImpl: mediaFetch(false),
      onEvent: async (event) => {
        seen.push(event);
        controller.abort();
      },
      pollFn: async () => {
        polls += 1;
        // One failing batch; no event fires (all attachments fail), so the
        // abort comes from the second poll, not from onEvent.
        if (polls > 1) {
          controller.abort();
          return [];
        }
        return [mediaUpdate(1, 33, { photo: [{ file_id: "bad", file_size: 11 }] })];
      },
    });
    expect(seen).toHaveLength(0);
    await rm(dir, { recursive: true, force: true });
  });

  it("drops the offset on token rotation (fingerprint mismatch)", async () => {
    const store = new FakeKeyedStore<OffsetState>();
    await writeUpdateOffset(store, BOT_TOKEN, 5);
    expect(await readUpdateOffset(store, BOT_TOKEN)).toBe(5);
    const rotated = "123456789:REVOKED-TOKEN";
    expect(await readUpdateOffset(store, rotated)).toBeNull();
    expect(await readUpdateOffset(store, "999:OTHER")).toBeNull();
    expect(fingerprintTelegramBotToken(BOT_TOKEN)).not.toBe(fingerprintTelegramBotToken(rotated));
  });

  // --- E2: the approval card's button clicks (`callback_query`).

  function makeCallbackUpdate(
    updateId: number,
    data: string,
    opts?: { threadId?: number; chatType?: string; withMessage?: boolean },
  ): TelegramUpdateShape {
    return {
      update_id: updateId,
      callback_query: {
        id: `cbq-${updateId}`,
        from: { id: 42, first_name: "Human" },
        ...(opts?.withMessage === false
          ? {}
          : {
              message: {
                message_id: 90,
                chat: {
                  id: -100_000_000_001,
                  type: opts?.chatType ?? "supergroup",
                  title: "Test Group",
                },
                ...(opts?.threadId !== undefined ? { message_thread_id: opts.threadId } : {}),
              },
            }),
        data,
      },
    };
  }

  /** Records fetch calls (answerCallbackQuery) and answers them ok. */
  function callbackFetch(calls: Array<{ url: string; body: string | null }>) {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: init?.body === null ? null : String(init?.body ?? null),
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
  }

  it("answers the query silently and hands the RAW callback to onApprovalCallback (ack-first)", async () => {
    const controller = new AbortController();
    const fetchCalls: Array<{ url: string; body: string | null }> = [];
    const seen: import("./approval-callback.js").TelegramCallbackQueryShape[] = [];
    await runTelegramPoll({
      accountId: "acct",
      botToken: BOT_TOKEN,
      apiRoot: "https://api.telegram.org",
      botId: BOT_ID,
      abortSignal: controller.signal,
      updateOffsetStore: new FakeKeyedStore<OffsetState>(),
      fetchImpl: callbackFetch(fetchCalls),
      onEvent: async (event) => {
        controller.abort();
        void event;
      },
      onApprovalCallback: async (callbackQuery) => {
        seen.push(callbackQuery);
      },
      pollFn: async () => [
        makeCallbackUpdate(5, "allow:card-1", { threadId: 7 }),
        makeUpdate(6, 12, "follow-up"),
      ],
    });
    expect(seen).toHaveLength(1);
    // The RAW wire update goes to the seam (the L4 parser narrows the
    // envelope; the hub's card-value parser owns `data`'s format).
    expect(seen[0]?.data).toBe("allow:card-1");
    expect(seen[0]?.from?.id).toBe(42);
    expect(seen[0]?.message?.message_thread_id).toBe(7);
    // The ack is a silent answerCallbackQuery (no text — the hub-side card
    // update is the user-visible outcome).
    const ackCall = fetchCalls.find((call) => call.url.includes("answerCallbackQuery"));
    expect(ackCall?.url).toBe(
      `https://api.telegram.org/bot${encodeURIComponent(BOT_TOKEN)}/answerCallbackQuery`,
    );
    expect(ackCall?.body).toBe("callback_query_id=cbq-5");
    // Silent ack: no text / alert params (the hub-side card update is the
    // user-visible outcome).
    expect(ackCall?.body?.includes("text")).toBe(false);
  });

  it("does NOT re-dispatch a re-served update_id (the vertical's dedupe)", async () => {
    const controller = new AbortController();
    const seen: unknown[] = [];
    let polls = 0;
    await runTelegramPoll({
      accountId: "acct",
      botToken: BOT_TOKEN,
      apiRoot: "https://api.telegram.org",
      botId: BOT_ID,
      abortSignal: controller.signal,
      updateOffsetStore: new FakeKeyedStore<OffsetState>(),
      fetchImpl: callbackFetch([]),
      onEvent: async () => {},
      onApprovalCallback: async (callbackQuery) => {
        seen.push(callbackQuery);
      },
      pollFn: async () => {
        polls += 1;
        if (polls >= 2) controller.abort();
        // The same update_id in two consecutive batches (the offset-persist
        // gap re-serves it): the second must be a no-op.
        return [makeCallbackUpdate(5, "allow:card-1")];
      },
    });
    expect(polls).toBe(2);
    expect(seen).toHaveLength(1);
  });

  it("answers and drops a callback_query when no approval seam is wired", async () => {
    const controller = new AbortController();
    const fetchCalls: Array<{ url: string; body: string | null }> = [];
    let polls = 0;
    await runTelegramPoll({
      accountId: "acct",
      botToken: BOT_TOKEN,
      apiRoot: "https://api.telegram.org",
      botId: BOT_ID,
      abortSignal: controller.signal,
      updateOffsetStore: new FakeKeyedStore<OffsetState>(),
      fetchImpl: callbackFetch(fetchCalls),
      onEvent: async () => {},
      pollFn: async () => {
        polls += 1;
        if (polls >= 2) controller.abort();
        return [makeCallbackUpdate(5, "allow:card-1")];
      },
    });
    expect(polls).toBe(2);
    // No seam: the click is still acked (no redelivery, no wedge).
    expect(fetchCalls.filter((call) => call.url.includes("answerCallbackQuery"))).toHaveLength(1);
  });

  it("keeps polling when the approval callback throws (ack-on-error, P13)", async () => {
    const controller = new AbortController();
    let polls = 0;
    let faults = 0;
    await runTelegramPoll({
      accountId: "acct",
      botToken: BOT_TOKEN,
      apiRoot: "https://api.telegram.org",
      botId: BOT_ID,
      abortSignal: controller.signal,
      updateOffsetStore: new FakeKeyedStore<OffsetState>(),
      fetchImpl: callbackFetch([]),
      onEvent: async (event) => {
        if (event.externalMessageId === "12") controller.abort();
      },
      onApprovalCallback: async () => {
        faults += 1;
        throw new Error("seam fault");
      },
      pollFn: async () => {
        polls += 1;
        if (polls === 1) return [makeCallbackUpdate(5, "allow:card-1")];
        // The loop must still be alive after the seam fault on poll 1: the
        // next batch's message is what aborts it.
        return [makeUpdate(6, 12, "follow-up")];
      },
    });
    expect(faults).toBe(1);
    expect(polls).toBe(2);
  });
});
