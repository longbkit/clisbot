// Simulated Telegram Bot API over loopback HTTP.
//
// The vertical reaches it through the account's `config.apiRoot`
// (`client/bot-api.ts:241`), which grammY takes as `apiRoot` — so the real
// grammY client, its long-poll loop, its throttler and its error classes all
// run against this server.
//
// `getUpdates` is a real long poll: it holds the response open until an update
// is delivered or the client's `timeout` elapses. Answering immediately with an
// empty batch would spin the poller and hide the 30 s abort class of bug the
// wave-4 live run found.

import {
  pendingFault,
  sendJson,
  SimRecorder,
  startSimHttpServer,
  waitFor,
  type SimResponseFault,
  type SimFaultRule,
  type SimHttpServer,
  type SimRequest,
} from "./server.js";

export interface SimTelegramMessage {
  message_id: number;
  chat_id: number | string;
  text: string;
  message_thread_id?: number;
  /** Every `editMessageText` body this message has carried, oldest first. */
  edits: string[];
  /** The Bot API method that produced it: sendMessage, sendPoll, sendDocument… */
  method: string;
  deleted: boolean;
  reactions: string[];
}

export interface SimTelegramOptions {
  readonly token?: string;
  readonly botId?: number;
  readonly botUsername?: string;
  /** Long-poll ceiling. Kept short so a test never waits a real 30 s. */
  readonly maxHoldMs?: number;
}

export interface SimTelegram {
  /** Put this in the account config: `config: { apiRoot: sim.apiRoot }`. */
  readonly apiRoot: string;
  readonly token: string;
  readonly botId: number;
  readonly botUsername: string;
  readonly recorder: SimRecorder;
  /** Queues a raw update for the next `getUpdates`; returns its `update_id`. */
  deliverUpdate(update: Record<string, unknown>): number;
  /** Convenience for the commonest inbound: a group text mentioning the bot. */
  deliverMessage(params: {
    chatId: number | string;
    text: string;
    fromId?: number;
    fromUsername?: string;
    chatType?: "private" | "group" | "supergroup";
    messageThreadId?: number;
    messageId?: number;
  }): number;
  deliverCallbackQuery(params: {
    chatId: number | string;
    data: string;
    messageId: number;
    fromId?: number;
  }): number;
  /** Every Bot API call, newest last. */
  requests(filter?: string | RegExp | ((request: SimRequest) => boolean)): readonly SimRequest[];
  /** Parsed argument objects for one Bot API method, e.g. `"sendMessage"`. */
  calls(method: string): readonly Record<string, unknown>[];
  /** Read-back: the transcript of a chat, oldest first. */
  transcript(chatId: number | string): readonly SimTelegramMessage[];
  /** The offset the bot has confirmed, i.e. what a restart would resume from. */
  readonly confirmedOffset: number;
  injectFault(rule: SimFaultRule): void;
  waitForPoll(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

/** Telegram renders every failure as `{ok:false,error_code,description}`. */
function telegramFaultResponse(fault: SimResponseFault): { status: number; body: unknown } {
  if (fault.kind === "rate-limit") {
    return {
      status: 429,
      body: {
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after " + fault.retryAfterSeconds,
        parameters: { retry_after: fault.retryAfterSeconds },
      },
    };
  }
  if (fault.kind === "unauthorized") {
    return { status: 401, body: { ok: false, error_code: 401, description: "Unauthorized" } };
  }
  const status = fault.status ?? 500;
  return { status, body: { ok: false, error_code: status, description: "Internal Server Error" } };
}

export async function startTelegramSim(options: SimTelegramOptions = {}): Promise<SimTelegram> {
  const token = options.token ?? "1111111:SIM-TOKEN";
  const botId = options.botId ?? Number(token.split(":")[0] ?? 1_111_111);
  const botUsername = options.botUsername ?? "sim_bot";
  const maxHoldMs = options.maxHoldMs ?? 250;
  const recorder = new SimRecorder();
  const chats = new Map<string, SimTelegramMessage[]>();
  const queue: Array<Record<string, unknown>> = [];
  let updateCounter = 400_000;
  let messageCounter = 1_000;
  let confirmedOffset = 0;
  let pollCount = 0;
  let closed = false;

  const chat = (chatId: number | string): SimTelegramMessage[] => {
    const key = String(chatId);
    const existing = chats.get(key);
    if (existing) return existing;
    const created: SimTelegramMessage[] = [];
    chats.set(key, created);
    return created;
  };

  function recordOutbound(method: string, args: Record<string, unknown>): SimTelegramMessage {
    messageCounter += 1;
    const threadId = args["message_thread_id"];
    const message: SimTelegramMessage = {
      message_id: messageCounter,
      chat_id: (args["chat_id"] as number | string | undefined) ?? 0,
      text: String(args["text"] ?? args["caption"] ?? args["question"] ?? ""),
      ...(threadId === undefined ? {} : { message_thread_id: Number(threadId) }),
      edits: [],
      method,
      deleted: false,
      reactions: [],
    };
    chat(message.chat_id).push(message);
    return message;
  }

  function messageResult(message: SimTelegramMessage): unknown {
    return {
      message_id: message.message_id,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: Number(message.chat_id) || message.chat_id,
        type: "supergroup",
        title: "Sim Chat",
      },
      from: { id: botId, is_bot: true, username: botUsername, first_name: "Sim" },
      text: message.text,
      ...(message.message_thread_id === undefined
        ? {}
        : { message_thread_id: message.message_thread_id }),
    };
  }

  function findMessage(args: Record<string, unknown>): SimTelegramMessage | undefined {
    const id = Number(args["message_id"]);
    return chat((args["chat_id"] as number | string | undefined) ?? 0).find(
      (message) => message.message_id === id,
    );
  }

  /** Long poll: hold until an update lands or the caller's timeout expires. */
  async function getUpdates(args: Record<string, unknown>): Promise<unknown> {
    pollCount += 1;
    const offset = Number(args["offset"] ?? 0);
    if (offset > 0) confirmedOffset = offset;
    const requested = Number(args["timeout"] ?? 0) * 1_000;
    const deadline = Date.now() + Math.min(requested === 0 ? maxHoldMs : requested, maxHoldMs);
    // `closed` is set by close(), so an in-flight long poll returns instead of
    // outliving the sim.
    // eslint-disable-next-line no-unmodified-loop-condition
    while (queue.length === 0 && Date.now() < deadline && !closed) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const batch = queue.splice(0, Number(args["limit"] ?? 100));
    return { ok: true, result: batch };
  }

  // One faithful Bot API router: splitting it by method family would hide the
  // wire surface this file exists to state.
  // eslint-disable-next-line complexity
  function route(method: string, args: Record<string, unknown>): unknown | Promise<unknown> {
    switch (method) {
      case "getMe":
        return {
          ok: true,
          result: {
            id: botId,
            is_bot: true,
            username: botUsername,
            first_name: "Sim",
            can_join_groups: true,
          },
        };
      case "getUpdates":
        return getUpdates(args);
      case "deleteWebhook":
      case "setWebhook":
      case "setMyCommands":
      case "sendChatAction":
        return { ok: true, result: true };
      case "getWebhookInfo":
        return { ok: true, result: { url: "", pending_update_count: 0 } };
      case "sendMessage":
      case "sendDocument":
      case "sendPhoto":
      case "sendVideo":
      case "sendAudio":
      case "sendVoice":
      case "sendSticker":
      case "sendLocation":
      case "sendPoll":
        return { ok: true, result: messageResult(recordOutbound(method, args)) };
      case "editMessageText": {
        const target = findMessage(args);
        if (target === undefined) {
          return {
            ok: false,
            error_code: 400,
            description: "Bad Request: message to edit not found",
          };
        }
        const next = String(args["text"] ?? "");
        if (next === target.text) {
          return {
            ok: false,
            error_code: 400,
            description: "Bad Request: message is not modified",
          };
        }
        target.edits.push(target.text);
        target.text = next;
        return { ok: true, result: messageResult(target) };
      }
      case "deleteMessage": {
        const target = findMessage(args);
        if (target === undefined)
          return {
            ok: false,
            error_code: 400,
            description: "Bad Request: message to delete not found",
          };
        target.deleted = true;
        return { ok: true, result: true };
      }
      case "setMessageReaction": {
        const target = findMessage(args);
        if (target === undefined)
          return { ok: false, error_code: 400, description: "Bad Request: message not found" };
        const reaction = args["reaction"];
        target.reactions = Array.isArray(reaction)
          ? reaction.map((entry) => String((entry as { emoji?: unknown }).emoji ?? entry))
          : [];
        return { ok: true, result: true };
      }
      case "answerCallbackQuery":
      case "pinChatMessage":
      case "unpinChatMessage":
        return { ok: true, result: true };
      case "getFile":
        return {
          ok: true,
          result: {
            file_id: String(args["file_id"] ?? ""),
            file_path: "sim/file.bin",
            file_size: 4,
          },
        };
      case "getChat":
        return {
          ok: true,
          result: { id: args["chat_id"], type: "supergroup", title: "Sim Chat", is_forum: true },
        };
      case "createForumTopic":
        return {
          ok: true,
          result: { message_thread_id: (messageCounter += 1), name: String(args["name"] ?? "sim") },
        };
      case "editForumTopic":
        return { ok: true, result: true };
      case "getForumTopicIconStickers":
      case "getCustomEmojiStickers":
        return { ok: true, result: [] };
      default:
        return {
          ok: false,
          error_code: 404,
          description: `Not Found: method not found (${method})`,
        };
    }
  }

  const http: SimHttpServer = await startSimHttpServer({
    recorder,
    handler: async (request, { response }) => {
      const fault = pendingFault(request);
      if (fault !== undefined && fault.kind !== "socket-drop") {
        const rendered = telegramFaultResponse(fault);
        sendJson(response, rendered.status, rendered.body);
        return;
      }
      // `/bot<token>/<method>` and the file path `/file/bot<token>/<path>`.
      if (request.path.startsWith("/file/")) {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(Buffer.from("sim!"));
        return;
      }
      const method = request.path.split("/").pop() ?? "";
      const args = (request.body ?? {}) as Record<string, unknown>;
      sendJson(response, 200, await route(method, args));
    },
  });

  /**
   * The entities Telegram attaches to a text message. A group message only
   * reaches an agent when it addresses the bot, and a command is only a command
   * when it carries a `bot_command` entity — a sim that omits them silently
   * exercises the "ignored" path.
   */
  function telegramTextEntities(text: string): Array<Record<string, unknown>> {
    const entities: Array<Record<string, unknown>> = [];
    const command = /^\/[A-Za-z0-9_]+(@[A-Za-z0-9_]+)?/u.exec(text);
    if (command) entities.push({ type: "bot_command", offset: 0, length: command[0].length });
    for (const match of text.matchAll(/@[A-Za-z0-9_]{3,}/gu)) {
      if (match.index === undefined) continue;
      entities.push({ type: "mention", offset: match.index, length: match[0].length });
    }
    return entities;
  }

  function deliverUpdate(update: Record<string, unknown>): number {
    updateCounter += 1;
    queue.push({ update_id: updateCounter, ...update });
    return updateCounter;
  }

  return {
    apiRoot: http.baseUrl,
    token,
    botId,
    botUsername,
    recorder,
    deliverUpdate,
    deliverMessage(params) {
      messageCounter += 1;
      return deliverUpdate({
        message: {
          message_id: params.messageId ?? messageCounter,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: params.chatId,
            type: params.chatType ?? "supergroup",
            title: "Sim Chat",
            ...(params.messageThreadId === undefined ? {} : { is_forum: true }),
          },
          from: {
            id: params.fromId ?? 900_001,
            is_bot: false,
            first_name: "Sim Sender",
            username: params.fromUsername ?? "sim_sender",
          },
          text: params.text,
          ...(telegramTextEntities(params.text).length === 0
            ? {}
            : { entities: telegramTextEntities(params.text) }),
          ...(params.messageThreadId === undefined
            ? {}
            : { message_thread_id: params.messageThreadId, is_topic_message: true }),
        },
      });
    },
    deliverCallbackQuery(params) {
      return deliverUpdate({
        callback_query: {
          id: `cb-${updateCounter + 1}`,
          from: { id: params.fromId ?? 900_001, is_bot: false, first_name: "Sim Sender" },
          data: params.data,
          chat_instance: "sim",
          message: {
            message_id: params.messageId,
            date: Math.floor(Date.now() / 1000),
            chat: { id: params.chatId, type: "supergroup", title: "Sim Chat" },
          },
        },
      });
    },
    requests: (filter) => recorder.requests(filter),
    calls: (method) =>
      recorder
        .requests((request) => request.path.endsWith(`/${method}`))
        .map((request) => (request.body ?? {}) as Record<string, unknown>),
    transcript: (chatId) => [...chat(chatId)],
    get confirmedOffset() {
      return confirmedOffset;
    },
    injectFault: (rule) => recorder.injectFault(rule),
    waitForPoll: (timeoutMs) =>
      waitFor(() => pollCount > 0, {
        what: "the first Telegram getUpdates poll",
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      }),
    async close() {
      closed = true;
      await http.close();
    },
  };
}
