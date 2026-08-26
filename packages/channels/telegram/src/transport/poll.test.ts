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
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: 1_700_000_000,
      text,
      chat: { id: -100_000_000_001, type: "supergroup", title: "Test Group" },
      from: {
        // own bot = the account's own bot id; foreign bot = a DIFFERENT bot
        // (e.g. the E2E master bot acting as the external sender); else human.
        id: fromOwnBot ? BOT_ID : fromForeignBot ? FOREIGN_BOT_ID : 42,
        is_bot: fromOwnBot || fromForeignBot,
        first_name: fromOwnBot || fromForeignBot ? "A Bot" : "Human",
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

  it("drops the offset on token rotation (fingerprint mismatch)", async () => {
    const store = new FakeKeyedStore<OffsetState>();
    await writeUpdateOffset(store, BOT_TOKEN, 5);
    expect(await readUpdateOffset(store, BOT_TOKEN)).toBe(5);
    const rotated = "123456789:REVOKED-TOKEN";
    expect(await readUpdateOffset(store, rotated)).toBeNull();
    expect(await readUpdateOffset(store, "999:OTHER")).toBeNull();
    expect(fingerprintTelegramBotToken(BOT_TOKEN)).not.toBe(fingerprintTelegramBotToken(rotated));
  });
});
