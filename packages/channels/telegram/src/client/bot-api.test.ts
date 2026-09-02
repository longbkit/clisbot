// COMPAT(clisbot-control-plane): targeted tests for the L1 text-send path —
// the F-07 regression (`message_thread_id` must ride on chunk 0 of the
// PLAIN-text path, not just the rich one) and the C5 rich-HTML path
// (markdown → Bot API HTML, `parse_mode: HTML`, tag-aware chunking). The
// fake `TelegramApi` records every `sendMessage` call so the assertions are
// on the actual request params, not the rendered text.

import { describe, expect, it } from "vitest";
import {
  buildTelegramClientOptions,
  editTelegramMessageText,
  resolveTelegramAccount,
  sendTelegramText,
  type TelegramApi,
} from "./bot-api.js";

interface RecordedSend {
  chatId: number;
  text: string;
  params: Record<string, unknown> | undefined;
}

interface RecordedEdit {
  chatId: number;
  messageId: number;
  text: string;
  other: Record<string, unknown> | undefined;
}

/** A deterministic fake Bot API that records every `sendMessage` +
 * `editMessageText` call; the G7–G10 media methods are no-ops that return a
 * message id (outbound-media.test.ts carries a media-recording fake). */
function fakeTelegramApi(sent: RecordedSend[], edits: RecordedEdit[] = []): TelegramApi {
  let nextId = 1000;
  const media = () => async (chatId: number, _file: unknown, _params?: Record<string, unknown>) => {
    nextId += 1;
    return { message_id: nextId, chat: { id: chatId } };
  };
  return {
    async getMe() {
      return { id: 1, is_bot: true, first_name: "test-bot" };
    },
    async getChat(chatId: string) {
      return { id: Number(chatId) };
    },
    async sendMessage(chatId: number, text: string, params?: Record<string, unknown>) {
      sent.push({ chatId, text, params });
      nextId += 1;
      return { message_id: nextId, chat: { id: chatId } };
    },
    async editMessageText(
      chatId: number,
      messageId: number,
      text: string,
      other?: Record<string, unknown>,
    ) {
      edits.push({ chatId, messageId, text, other });
      return { ok: true };
    },
    // The liveness surface (typing.test.ts records it; this fake answers it).
    async sendChatAction() {
      return true;
    },
    sendPhoto: media(),
    sendDocument: media(),
    sendAudio: media(),
    sendVoice: media(),
    sendVideo: media(),
    sendAnimation: media(),
  };
}

const TOPIC_ID = 7;

describe("sendTelegramText — plain path (F-07 regression)", () => {
  it("carries message_thread_id on the chunk-0 request params", async () => {
    const sent: RecordedSend[] = [];
    const api = fakeTelegramApi(sent);
    const result = await sendTelegramText({
      api,
      chatId: -100,
      text: "hello topic",
      messageThreadId: TOPIC_ID,
    });
    expect(sent.length).toBe(1);
    expect(sent[0]?.params).toEqual({ message_thread_id: TOPIC_ID });
    expect(sent[0]?.text).toBe("hello topic");
    expect(sent[0]?.chatId).toBe(-100);
    expect(result.messageId).not.toBe("");
  });

  it("carries message_thread_id on EVERY chunk of a multi-chunk topic send", async () => {
    const sent: RecordedSend[] = [];
    const api = fakeTelegramApi(sent);
    // 900 x "word " = 4500 chars > 4000 → two plain-text chunks.
    const text = "word ".repeat(900);
    await sendTelegramText({ api, chatId: -100, text, messageThreadId: TOPIC_ID });
    expect(sent.length).toBeGreaterThan(1);
    // Topic placement is a property of the whole reply: a continuation chunk
    // that dropped `message_thread_id` would land in the forum's General
    // (root) instead of the topic (live G10 scatter, 2026-08-28).
    for (const s of sent) {
      expect(s.params).toEqual({ message_thread_id: TOPIC_ID });
    }
  });

  it("does NOT carry message_thread_id when no thread is given", async () => {
    const sent: RecordedSend[] = [];
    const api = fakeTelegramApi(sent);
    await sendTelegramText({ api, chatId: -100, text: "plain root post" });
    expect(sent.length).toBe(1);
    const params = sent[0]?.params ?? {};
    expect(params["message_thread_id"]).toBeUndefined();
  });

  it("carries reply_parameters on chunk 0 when replyToMessageId is given", async () => {
    const sent: RecordedSend[] = [];
    const api = fakeTelegramApi(sent);
    await sendTelegramText({ api, chatId: -100, text: "a reply", replyToMessageId: 42 });
    expect(sent[0]?.params).toEqual({ reply_parameters: { message_id: 42 } });
  });

  it("carries thread + reply on chunk 0 and thread only on chunk 1+ of a multi-chunk reply", async () => {
    const sent: RecordedSend[] = [];
    const api = fakeTelegramApi(sent);
    // 900 x "word " = 4500 chars > 4000 → two plain-text chunks.
    const text = "word ".repeat(900);
    await sendTelegramText({
      api,
      chatId: -100,
      text,
      messageThreadId: TOPIC_ID,
      replyToMessageId: 42,
    });
    expect(sent.length).toBeGreaterThan(1);
    // The reply-to quote is single-use (Bot API's one-reply-target rule);
    // the topic id is NOT — continuations must stay in the topic.
    expect(sent[0]?.params).toEqual({
      message_thread_id: TOPIC_ID,
      reply_parameters: { message_id: 42 },
    });
    for (const later of sent.slice(1)) {
      expect(later.params).toEqual({ message_thread_id: TOPIC_ID });
    }
  });

  it("carries thread + reply + parse_mode on chunk 0 and thread + parse_mode on chunk 1+ of a rich send", async () => {
    const sent: RecordedSend[] = [];
    const api = fakeTelegramApi(sent);
    const text = "word ".repeat(900);
    await sendTelegramText({
      api,
      chatId: -100,
      text,
      rich: true,
      messageThreadId: TOPIC_ID,
      replyToMessageId: 42,
    });
    expect(sent.length).toBeGreaterThan(1);
    expect(sent[0]?.params).toEqual({
      message_thread_id: TOPIC_ID,
      reply_parameters: { message_id: 42 },
      parse_mode: "HTML",
    });
    for (const later of sent.slice(1)) {
      expect(later.params).toEqual({ message_thread_id: TOPIC_ID, parse_mode: "HTML" });
    }
  });
});

describe("sendTelegramText — rich path (C5 markdown → Bot API HTML)", () => {
  it("converts markdown to HTML and posts with parse_mode: HTML", async () => {
    const sent: RecordedSend[] = [];
    const api = fakeTelegramApi(sent);
    await sendTelegramText({
      api,
      chatId: -100,
      text: "**bold** and `code` and [link](https://example.com)",
      rich: true,
    });
    expect(sent.length).toBe(1);
    expect(sent[0]?.params).toEqual({ parse_mode: "HTML" });
    expect(sent[0]?.text).toBe(
      '<b>bold</b> and <code>code</code> and <a href="https://example.com">link</a>',
    );
  });

  it("chunks long rich HTML tag-balanced and keeps parse_mode on every chunk", async () => {
    const sent: RecordedSend[] = [];
    const api = fakeTelegramApi(sent);
    // A long fenced code block: the rendered HTML nests `<pre><code ...>`
    // across the whole payload, so a naive split would strand a dangling tag.
    // 600 lines → ~4245 chars of HTML > the 4000 chunk limit → 2 chunks.
    const text = "```bash\n" + "echo x\n".repeat(600) + "```";
    await sendTelegramText({ api, chatId: -100, text, rich: true });
    expect(sent.length).toBeGreaterThan(1);
    for (const s of sent) {
      expect(s.params).toEqual({ parse_mode: "HTML" });
      // No chunk may end with an open tag or start with a close tag.
      expect(/<pre><code[^>]*$/.test(s.text)).toBe(false);
      expect(s.text.startsWith("</code>")).toBe(false);
    }
  });

  it("posts plain text (no parse_mode, no conversion) when rich is off", async () => {
    const sent: RecordedSend[] = [];
    const api = fakeTelegramApi(sent);
    await sendTelegramText({ api, chatId: -100, text: "**still markdown**" });
    expect(sent.length).toBe(1);
    expect(sent[0]?.params).toBeUndefined();
    expect(sent[0]?.text).toBe("**still markdown**");
  });
});

// --- the native approval card (COMPAT(clisbot-control-plane)) ----------------

const KEYBOARD: Record<string, unknown> = {
  inline_keyboard: [
    [{ text: "Approve", callback_data: "allow:req-1" }],
    [{ text: "Deny", callback_data: "deny:req-1" }],
  ],
};

describe("sendTelegramText — native card keyboard (E1)", () => {
  it("rides reply_markup on chunk 0 (next to the thread params) and reports cardPosted", async () => {
    const sent: RecordedSend[] = [];
    const api = fakeTelegramApi(sent);
    const result = await sendTelegramText({
      api,
      chatId: -100,
      text: "prompt text",
      messageThreadId: TOPIC_ID,
      replyMarkup: KEYBOARD,
      cardPosted: true,
    });
    expect(sent.length).toBe(1);
    expect(sent[0]?.params).toEqual({
      message_thread_id: TOPIC_ID,
      reply_markup: KEYBOARD,
    });
    expect(result["cardPosted"]).toBe(true);
  });

  it("keeps reply_markup ONLY on chunk 0 of a multi-chunk send", async () => {
    const sent: RecordedSend[] = [];
    const api = fakeTelegramApi(sent);
    const text = "word ".repeat(900); // 4500 chars → two chunks
    await sendTelegramText({ api, chatId: -100, text, replyMarkup: KEYBOARD });
    expect(sent.length).toBeGreaterThan(1);
    expect(sent[0]?.params).toEqual({ reply_markup: KEYBOARD });
    for (const later of sent.slice(1)) {
      const params = later.params ?? {};
      expect(params["reply_markup"]).toBeUndefined();
    }
  });

  it("omits reply_markup entirely when the arg is absent", async () => {
    const sent: RecordedSend[] = [];
    const api = fakeTelegramApi(sent);
    const result = await sendTelegramText({ api, chatId: -100, text: "plain" });
    expect(sent[0]?.params).toBeUndefined();
    expect(result["cardPosted"]).toBeUndefined();
  });
});

describe("editTelegramMessageText — the card's in-place update", () => {
  it("edits the target message and strips the keyboard when clearCard", async () => {
    const edits: RecordedEdit[] = [];
    const api = fakeTelegramApi([], edits);
    await editTelegramMessageText({
      api,
      chatId: -100,
      messageId: 42,
      text: "Approved Bash (`req-1`) by tg:555.",
      clearCard: true,
    });
    expect(edits.length).toBe(1);
    expect(edits[0]?.chatId).toBe(-100);
    expect(edits[0]?.messageId).toBe(42);
    expect(edits[0]?.other).toEqual({ reply_markup: { inline_keyboard: [] } });
  });

  it("keeps the card live when clearCard is off and adds parse_mode when rich", async () => {
    const edits: RecordedEdit[] = [];
    const api = fakeTelegramApi([], edits);
    await editTelegramMessageText({
      api,
      chatId: -100,
      messageId: 43,
      text: "**done**",
      rich: true,
    });
    expect(edits[0]?.other).toEqual({ parse_mode: "HTML" });
    expect(edits[0]?.text).toBe("<b>done</b>");
  });

  it("sends no extra params when neither clearCard nor rich", async () => {
    const edits: RecordedEdit[] = [];
    const api = fakeTelegramApi([], edits);
    await editTelegramMessageText({ api, chatId: -100, messageId: 44, text: "plain" });
    expect(edits[0]?.other).toBeUndefined();
  });

  it("treats the 400 'message is not modified' as success (byte-identical edit)", async () => {
    const api = fakeTelegramApi([], []);
    api.editMessageText = async () => {
      throw new Error("Bad Request: message is not modified");
    };
    await expect(
      editTelegramMessageText({ api, chatId: -100, messageId: 45, text: "same" }),
    ).resolves.toBeUndefined();
  });

  it("throws on any other edit failure", async () => {
    const api = fakeTelegramApi([], []);
    api.editMessageText = async () => {
      throw new Error("Bad Request: message to edit not found");
    };
    await expect(
      editTelegramMessageText({ api, chatId: -100, messageId: 46, text: "gone" }),
    ).rejects.toThrow(/message to edit not found/);
  });

  it("throws on empty text (no no-op edits)", async () => {
    const api = fakeTelegramApi([], []);
    await expect(
      editTelegramMessageText({ api, chatId: -100, messageId: 47, text: "   " }),
    ).rejects.toThrow(/non-empty/);
  });
});

describe("resolveTelegramAccount — richMessages default (D-003, amended 2026-08-29)", () => {
  const cfg = (config: unknown) =>
    ({
      channels: {
        telegram: {
          accounts: { bot: { botToken: "tg-token", ...(config !== undefined ? { config } : {}) } },
        },
      },
    }) as never;

  it("renders markdown (richMessages on) when the account has no config", () => {
    expect(resolveTelegramAccount(cfg(undefined), "bot").config.richMessages).toBe(true);
  });

  it("renders markdown (richMessages on) when the account config sets no value", () => {
    expect(resolveTelegramAccount(cfg({ timeoutSeconds: 90 }), "bot").config.richMessages).toBe(
      true,
    );
  });

  it("honors an explicit richMessages: true", () => {
    expect(resolveTelegramAccount(cfg({ richMessages: true }), "bot").config.richMessages).toBe(
      true,
    );
  });

  it("opts back to plain text on an explicit richMessages: false", () => {
    expect(resolveTelegramAccount(cfg({ richMessages: false }), "bot").config.richMessages).toBe(
      false,
    );
  });
});

describe("buildTelegramClientOptions — bounded Bot API requests", () => {
  it("applies a finite default when the account omits timeoutSeconds", () => {
    const account = resolveTelegramAccount(
      {
        channels: { telegram: { accounts: { bot: { botToken: "tg-token" } } } },
      },
      "bot",
    );
    expect(buildTelegramClientOptions(account).timeoutSeconds).toBe(30);
  });

  it("keeps an explicit account timeout", () => {
    const account = resolveTelegramAccount(
      {
        channels: {
          telegram: {
            accounts: { bot: { botToken: "tg-token", config: { timeoutSeconds: 12 } } },
          },
        },
      },
      "bot",
    );
    expect(buildTelegramClientOptions(account).timeoutSeconds).toBe(12);
  });
});
