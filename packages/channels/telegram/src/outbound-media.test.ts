// COMPAT(clisbot-control-plane): targeted tests for the Telegram outbound
// native-media path — the mime→Bot API method routing (G7–G10) and the native
// post (one file, one post, thread params on the request).

import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  sendTelegramMedia,
  TELEGRAM_MAX_PHOTO_BYTES,
  telegramMediaMethod,
  type TelegramMediaMethod,
} from "./outbound-media.js";
import type { TelegramApi } from "./client/bot-api.js";

const tmpDirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tg-outbound-media-"));
  tmpDirs.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("telegramMediaMethod — the mime→method routing (OpenClaw mirror)", () => {
  it("routes each mime to its Bot API method", () => {
    const table: Array<[string | undefined, TelegramMediaMethod]> = [
      ["image/gif", "sendAnimation"],
      ["image/png", "sendPhoto"],
      ["image/jpeg", "sendPhoto"],
      ["video/mp4", "sendVideo"],
      ["audio/ogg", "sendVoice"],
      ["audio/opus", "sendVoice"],
      ["audio/mpeg", "sendAudio"],
      ["application/pdf", "sendDocument"],
      ["application/zip", "sendDocument"],
      [undefined, "sendDocument"],
    ];
    for (const [mime, method] of table) {
      expect(telegramMediaMethod(mime)).toBe(method);
    }
  });
});

interface RecordedMedia {
  method: string;
  chatId: number;
  file: unknown;
  params: Record<string, unknown> | undefined;
}

/** A fake Bot API that records which media method was called + its args. */
function mediaRecordingApi(): { api: TelegramApi; calls: RecordedMedia[] } {
  const calls: RecordedMedia[] = [];
  const record =
    (method: string) => async (chatId: number, file: unknown, params?: Record<string, unknown>) => {
      calls.push({ method, chatId, file, params });
      return { message_id: 1234, chat: { id: chatId } };
    };
  const base = {
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
      return { ok: true };
    },
  };
  const api = {
    ...base,
    sendPhoto: record("sendPhoto"),
    sendDocument: record("sendDocument"),
    sendAudio: record("sendAudio"),
    sendVoice: record("sendVoice"),
    sendVideo: record("sendVideo"),
    sendAnimation: record("sendAnimation"),
  } as unknown as TelegramApi;
  return { api, calls };
}

describe("sendTelegramMedia — the native post", () => {
  it("posts an image over the Bot API photo limit as a document (OpenClaw photo fallback)", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "big.png");
    writeFileSync(filePath, Buffer.alloc(TELEGRAM_MAX_PHOTO_BYTES + 1));
    const { api, calls } = mediaRecordingApi();
    const result = await sendTelegramMedia({
      api,
      chatId: -100,
      filePath,
      fileName: "big.png",
      mime: "image/png",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("sendDocument");
    expect(result.messageId).toBe("1234");
  });

  it("posts an image under the Bot API photo limit through sendPhoto", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "shot.png");
    writeFileSync(filePath, Buffer.alloc(TELEGRAM_MAX_PHOTO_BYTES));
    const { api, calls } = mediaRecordingApi();
    await sendTelegramMedia({
      api,
      chatId: -100,
      filePath,
      fileName: "shot.png",
      mime: "image/png",
    });
    expect(calls[0]?.method).toBe("sendPhoto");
  });

  it("posts an image through sendPhoto with the native filename + thread params", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "shot.png");
    writeFileSync(filePath, "img-bytes");
    const { api, calls } = mediaRecordingApi();
    const result = await sendTelegramMedia({
      api,
      chatId: -100,
      filePath,
      fileName: "shot.png",
      mime: "image/png",
      messageThreadId: 7,
      caption: "hello",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("sendPhoto");
    expect(calls[0]?.chatId).toBe(-100);
    // The thread + caption params ride on the media post (the shared builder).
    expect(calls[0]?.params).toEqual({ message_thread_id: 7, caption: "hello" });
    expect(result.messageId).toBe("1234");
  });

  it("carries reply_parameters on the media post (single message, like the text path's chunk 0)", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "shot.png");
    writeFileSync(filePath, "img-bytes");
    const { api, calls } = mediaRecordingApi();
    await sendTelegramMedia({
      api,
      chatId: -100,
      filePath,
      fileName: "shot.png",
      mime: "image/png",
      messageThreadId: 7,
      replyToMessageId: 42,
    });
    expect(calls[0]?.params).toEqual({
      message_thread_id: 7,
      reply_parameters: { message_id: 42 },
    });
  });

  it("routes a gif through sendAnimation (not sendPhoto)", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "clip.gif");
    writeFileSync(filePath, "g");
    const { api, calls } = mediaRecordingApi();
    await sendTelegramMedia({
      api,
      chatId: -100,
      filePath,
      fileName: "clip.gif",
      mime: "image/gif",
    });
    expect(calls[0]?.method).toBe("sendAnimation");
  });

  it("omits the params object when there is no thread/caption", async () => {
    const dir = await makeDir();
    const filePath = join(dir, "a.jpg");
    writeFileSync(filePath, "j");
    const { api, calls } = mediaRecordingApi();
    await sendTelegramMedia({ api, chatId: 5, filePath, fileName: "a.jpg", mime: "image/jpeg" });
    expect(calls[0]?.params).toBeUndefined();
    expect(calls[0]?.method).toBe("sendPhoto");
  });
});
