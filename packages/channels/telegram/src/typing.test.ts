// The Telegram liveness surface: the action sent on start, kept live by THIS
// file's refresh timer, and cancelled (not cleared) on stop; the topic id rides
// on the action — including the forum's General topic, where a SEND must drop
// it (the pinned asymmetry, typing.ts).
//
// D-TG-025: the fake Bot API is now injected through upstream's own
// `TelegramSendOpts.api` override (forwarded by `typing.ts`) instead of the
// deleted `registerTelegramApiForTest` seam on the local L1 client. The
// assertions are unchanged.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostKeyedStore, HostRuntime } from "@getpaseo/channels-shared";
import { setChannelHostRuntime } from "./runtime-store.js";
import {
  clearTelegramTypingTimersForTest,
  resolveTypingThreadId,
  telegramTyping,
  TELEGRAM_TYPING_ACTION,
  TELEGRAM_TYPING_REFRESH_MS,
  type TelegramTypingArgs,
} from "./typing.js";

const CFG = {
  channels: { telegram: { accounts: { bot: { botToken: "tg-test-typing-token" } } } },
} as unknown as Record<string, unknown>;

interface Action {
  chatId: string | number;
  action: string;
  params?: Record<string, unknown>;
}

/** The fake api answers the first `succeeds` calls, then faults (a muted chat
 * / a bot that cannot initiate contact — the fault the hub breaker exists for). */
function install(succeeds = Number.POSITIVE_INFINITY): Action[] {
  const actions: Action[] = [];
  const api = {
    async getMe() {
      return { id: 1, is_bot: true, first_name: "b" };
    },
    async getChat(chatId: string) {
      return { id: Number(chatId) };
    },
    async sendMessage() {
      return { message_id: 1, chat: { id: 1 } };
    },
    async editMessageText() {
      return {};
    },
    async sendChatAction(chatId: number, action: string, params?: Record<string, unknown>) {
      if (actions.length >= succeeds) throw { description: "Forbidden: bot can't initiate" };
      actions.push({ chatId, action, ...(params !== undefined ? { params } : {}) });
      return true;
    },
  };
  installedApi = api;
  return actions;
}

let installedApi: unknown;

function memoryKeyedStore(): HostKeyedStore {
  const map = new Map<string, unknown>();
  return {
    register: async (key, value) => void map.set(key, value),
    registerIfAbsent: async (key, value) => (map.has(key) ? false : (map.set(key, value), true)),
    update: async () => false,
    lookup: async (key) => map.get(key),
    consume: async (key) => map.get(key),
    delete: async (key) => map.delete(key),
    entries: async () => [],
    clear: async () => map.clear(),
  };
}

const hostRuntime = {
  state: { openKeyedStore: () => memoryKeyedStore() },
  logging: { getChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
} as unknown as HostRuntime;

beforeEach(() => {
  setChannelHostRuntime(hostRuntime);
});

function args(overrides: Partial<TelegramTypingArgs> = {}): TelegramTypingArgs {
  return {
    cfg: CFG,
    accountId: "bot",
    to: "-1001234",
    action: "start",
    indicator: true,
    ...(installedApi ? { api: installedApi } : {}),
    ...overrides,
  };
}

afterEach(() => {
  clearTelegramTypingTimersForTest();
  vi.useRealTimers();
});

describe("telegramTyping", () => {
  it("sends one typing action to the chat", async () => {
    const actions = install();
    await telegramTyping(args());
    // D-TG-025: upstream passes the resolved chat id to the Bot API as a string.
    expect(actions).toEqual([{ chatId: "-1001234", action: TELEGRAM_TYPING_ACTION }]);
  });

  it("re-sends on its own refresh timer while the lease is open", async () => {
    // The ~5s Bot API expiry is the vendor's, so the refresh belongs here: the
    // Hub drives a lease once and never beats it.
    vi.useFakeTimers();
    const actions = install();
    await telegramTyping(args());
    expect(actions).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(TELEGRAM_TYPING_REFRESH_MS);
    await vi.advanceTimersByTimeAsync(TELEGRAM_TYPING_REFRESH_MS);
    expect(actions).toHaveLength(3);
  });

  it("stops refreshing on stop, and sends nothing on stop", async () => {
    vi.useFakeTimers();
    const actions = install();
    await telegramTyping(args());
    await telegramTyping(args({ action: "stop" }));
    expect(actions).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(TELEGRAM_TYPING_REFRESH_MS * 3);
    expect(actions).toHaveLength(1);
  });

  it("cancels its timer when a refresh tick faults", async () => {
    vi.useFakeTimers();
    const actions = install(1); // only the first send succeeds
    await telegramTyping(args());
    await vi.advanceTimersByTimeAsync(TELEGRAM_TYPING_REFRESH_MS);
    await vi.advanceTimersByTimeAsync(TELEGRAM_TYPING_REFRESH_MS * 3);
    expect(actions).toHaveLength(1);
  });

  it("does nothing on stop when nothing was open", async () => {
    const actions = install();
    await telegramTyping(args({ action: "stop" }));
    expect(actions).toHaveLength(0);
  });

  it("does nothing when the indicator leaf is off", async () => {
    const actions = install();
    await telegramTyping(args({ indicator: false, reactionEmoji: "eyes" }));
    expect(actions).toHaveLength(0);
  });

  it("carries message_thread_id for a topic turn", async () => {
    const actions = install();
    await telegramTyping(args({ threadId: "42" }));
    expect(actions[0]).toEqual({
      chatId: "-1001234",
      action: TELEGRAM_TYPING_ACTION,
      params: { message_thread_id: 42 },
    });
  });

  it("carries message_thread_id for the General topic (1), where a send must not", async () => {
    const actions = install();
    await telegramTyping(args({ threadId: "1" }));
    expect(actions[0]?.params).toEqual({ message_thread_id: 1 });
  });

  it("prefers the topic id baked into the target over the drive's threadId", async () => {
    const actions = install();
    await telegramTyping(args({ to: "-1001234:7", threadId: "42" }));
    expect(actions[0]?.params).toEqual({ message_thread_id: 7 });
  });

  it("rejects a non-numeric topic id instead of sending a malformed action", async () => {
    install();
    await expect(telegramTyping(args({ threadId: "not-a-number" }))).rejects.toThrow(
      /invalid Telegram topic id/,
    );
  });

  it("throws on a Bot API fault so the hub breaker can stop the loop", async () => {
    install(0); // no call succeeds
    await expect(telegramTyping(args())).rejects.toBeDefined();
  });
});

describe("typing thread-id resolution", () => {
  it("reads the target form first, then the drive's threadId, then nothing", () => {
    expect(resolveTypingThreadId({ chatId: "1", messageThreadId: 7 }, "42")).toBe(7);
    expect(resolveTypingThreadId({ chatId: "1" }, "42")).toBe(42);
    expect(resolveTypingThreadId({ chatId: "1" }, undefined)).toBeUndefined();
    expect(resolveTypingThreadId({ chatId: "1" }, "")).toBeUndefined();
  });
});
