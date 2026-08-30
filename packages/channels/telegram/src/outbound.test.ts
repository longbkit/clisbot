// COMPAT(clisbot-control-plane): targeted tests for the Telegram `sendMedia`
// drive-surface path (G7–G11) — the G11 gate posts the in-channel notice
// through the plain text path (instead of a silent drop) only when the file
// is oversized, and a missing local file throws. The fake Bot API
// is registered through the L1 test seam (`registerTelegramApiForTest`).

import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type {
  HostKeyedStore,
  HostKeyedStoreOptions,
  HostKeyedStoreRoot,
  HostRuntime,
} from "@getpaseo/channels-shared";
import { setChannelHostRuntime } from "./runtime-store.js";
import {
  clearTelegramApiForTest,
  registerTelegramApiForTest,
  type TelegramApi,
} from "./client/bot-api.js";
import { sendMedia, sendText } from "./outbound.js";

const CFG = {
  channels: {
    telegram: {
      accounts: {
        bot: { botToken: "tg-test-media-token" },
      },
    },
  },
} as unknown as Record<string, unknown>;

const tmpDirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tg-outbound-media-e2e-"));
  tmpDirs.push(dir);
  return dir;
}

afterAll(async () => {
  clearTelegramApiForTest();
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** An in-memory keyed store that satisfies the plane's seam (only `register`
 * + `lookup` are exercised by the outbound write-back). */
function fakeKeyedStore<T>(): HostKeyedStore<T> {
  const map = new Map<string, T>();
  return {
    async register(key, value) {
      map.set(key, value);
    },
    async registerIfAbsent(key, value) {
      if (map.has(key)) return false;
      map.set(key, value);
      return true;
    },
    async update(key, fn) {
      const next = fn(map.get(key));
      if (next === undefined) {
        map.delete(key);
        return false;
      }
      map.set(key, next);
      return true;
    },
    async lookup(key) {
      return map.get(key);
    },
    async consume(key) {
      const value = map.get(key);
      map.delete(key);
      return value;
    },
    async delete(key) {
      return map.delete(key);
    },
    async entries() {
      const now = Date.now();
      return Array.from(map.entries()).map(([key, value]) => ({
        key,
        value,
        createdAt: now,
      }));
    },
    async clear() {
      map.clear();
    },
  };
}

/** A minimal HostRuntime: the outbound path only reads `state.openKeyedStore`
 * and `logging.getChildLogger`. */
function fakeHostRuntime(): HostRuntime {
  const root: HostKeyedStoreRoot = {
    openKeyedStore(_options: HostKeyedStoreOptions): HostKeyedStore {
      return fakeKeyedStore();
    },
  };
  const childLogger = {
    warn: () => {},
    debug: () => {},
  };
  return {
    async onInboundReply() {
      throw new Error("not used by the outbound path");
    },
    state: root,
    logging: { getChildLogger: () => childLogger },
    channel: {},
  } as unknown as HostRuntime;
}

interface RecordedSend {
  chatId: number;
  text: string;
  params: Record<string, unknown> | undefined;
}

/** A fake Bot API that records every `sendMessage` call (the G11 notice rides
 * the plain text path; no media method is invoked). */
function textRecordingApi(sent: RecordedSend[]): TelegramApi {
  let nextId = 2000;
  const media = () => async () => {
    throw new Error("no media method should be called on the G11 notice path");
  };
  return {
    async getMe() {
      return { id: 1, is_bot: true, first_name: "b" };
    },
    async getChat(chatId: string) {
      return { id: Number(chatId) };
    },
    async sendMessage(chatId: number, text: string, params?: Record<string, unknown>) {
      sent.push({ chatId, text, params });
      nextId += 1;
      return { message_id: nextId, chat: { id: chatId } };
    },
    async editMessageText() {
      return { ok: true };
    },
    sendPhoto: media(),
    sendDocument: media(),
    sendAudio: media(),
    sendVoice: media(),
    sendVideo: media(),
    sendAnimation: media(),
  } as unknown as TelegramApi;
}

// --- "send me the file": text with a local-file link also posts the file ----

interface RecordedMedia {
  method: string;
  chatId: number;
  file: unknown;
  params: Record<string, unknown> | undefined;
}

/** A fake Bot API that records both `sendMessage` (text) and native media
 * sends, so explicit media behavior can be asserted. */
function mediaRecordingApi(sent: RecordedSend[], media: RecordedMedia[]): TelegramApi {
  let nextId = 3000;
  const record =
    (method: string) =>
    async (chatId: number, _file: unknown, params?: Record<string, unknown>) => {
      media.push({ method, chatId, file: _file, params });
      nextId += 1;
      return { message_id: nextId, chat: { id: chatId } };
    };
  return {
    async getMe() {
      return { id: 1, is_bot: true, first_name: "b" };
    },
    async getChat(chatId: string) {
      return { id: Number(chatId) };
    },
    async sendMessage(chatId: number, text: string, params?: Record<string, unknown>) {
      sent.push({ chatId, text, params });
      nextId += 1;
      return { message_id: nextId, chat: { id: chatId } };
    },
    async editMessageText() {
      return { ok: true };
    },
    sendPhoto: record("sendPhoto"),
    sendDocument: record("sendDocument"),
    sendAudio: record("sendAudio"),
    sendVoice: record("sendVoice"),
    sendVideo: record("sendVideo"),
    sendAnimation: record("sendAnimation"),
  } as unknown as TelegramApi;
}

describe("sendText — local-file links remain text-only", () => {
  it("does not post a media message for a local file link", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "chart-2026-08-28.png");
    writeFileSync(filePath, "img");
    const sent: RecordedSend[] = [];
    const media: RecordedMedia[] = [];
    setChannelHostRuntime(fakeHostRuntime());
    registerTelegramApiForTest("tg-test-media-token", mediaRecordingApi(sent, media));
    try {
      await sendText({
        cfg: CFG,
        accountId: "bot",
        to: "-100",
        text: `M\u00ednh \u0111\u00e2y. File: [chart-2026-08-28.png](<${filePath}>)`,
      } as never);
      // The text answer is posted and the link remains rendered as text.
      expect(sent.length).toBe(1);
      expect(sent[0]?.text).toContain(`<a href="${filePath}">chart-2026-08-28.png</a>`);
      expect(media.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does NOT post a media message for a URL link or a missing file", async () => {
    const sent: RecordedSend[] = [];
    const media: RecordedMedia[] = [];
    setChannelHostRuntime(fakeHostRuntime());
    registerTelegramApiForTest("tg-test-media-token", mediaRecordingApi(sent, media));
    await sendText({
      cfg: CFG,
      accountId: "bot",
      to: "-100",
      text: "[site](https://example.com/a.png) and [gone](/tmp/no-such-file-xyz.png)",
    } as never);
    expect(sent.length).toBe(1);
    expect(media.length).toBe(0);
  });

  it("does not upload a linked file with an unmapped extension", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "notes.txt");
    writeFileSync(filePath, "hi");
    const sent: RecordedSend[] = [];
    const media: RecordedMedia[] = [];
    setChannelHostRuntime(fakeHostRuntime());
    registerTelegramApiForTest("tg-test-media-token", mediaRecordingApi(sent, media));
    try {
      await sendText({
        cfg: CFG,
        accountId: "bot",
        to: "-100",
        text: `Here: [notes.txt](<${filePath}>)`,
      } as never);
      expect(sent.length).toBe(1);
      expect(sent[0]?.text).toContain(`<a href="${filePath}">notes.txt</a>`);
      expect(media.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("sendMedia — the G11 gate (notice instead of a silent drop)", () => {
  it("uploads an unmapped file through sendDocument", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "blob.zip");
    writeFileSync(filePath, "z");
    const sent: RecordedSend[] = [];
    setChannelHostRuntime(fakeHostRuntime());
    const media: RecordedMedia[] = [];
    registerTelegramApiForTest("tg-test-media-token", mediaRecordingApi(sent, media));
    const result = await sendMedia({
      cfg: CFG,
      accountId: "bot",
      to: "-100",
      filePath,
    } as never);
    expect(result.mediaPosted).toBe(true);
    expect(sent.length).toBe(0);
    expect(media).toHaveLength(1);
    expect(media[0]?.method).toBe("sendDocument");
  });

  it("throws when the local media file is missing", async () => {
    const sent: RecordedSend[] = [];
    setChannelHostRuntime(fakeHostRuntime());
    registerTelegramApiForTest("tg-test-media-token", textRecordingApi(sent));
    await expect(
      sendMedia({
        cfg: CFG,
        accountId: "bot",
        to: "-100",
        filePath: "/home/u/does/not/exist.png",
      } as never),
    ).rejects.toThrow(/not found/);
    expect(sent.length).toBe(0);
  });
});
