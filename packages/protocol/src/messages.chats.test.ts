import { describe, expect, test } from "vitest";
import {
  SessionEventSubscriptionSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

const now = "2026-09-26T00:00:00.000Z";
const chat = {
  id: "cht_0123456789abcdef",
  title: null,
  participants: [
    {
      botId: "bot_0123456789abcdef",
      slug: "ops-bot",
      displayName: "Ops Bot",
      addedAt: now,
      agentId: null,
    },
  ],
  rules: {
    interaction: { requireMention: false, whenBusy: "steer" },
    hops: { max: 3 },
    context: { maxMessages: 20 },
    limits: { maxInputCharacters: 8000 },
  },
  createdAt: now,
  updatedAt: now,
  lastMessageAt: null,
  archivedAt: null,
};
const line = {
  id: "msg_1",
  seq: 1,
  at: now,
  sender: { kind: "user" },
  text: "hello",
  hop: 0,
};

describe("chat wire schemas", () => {
  test("parses each request with only its required fields", () => {
    const requests = [
      { type: "chat.create.request", requestId: "r1", botIds: [chat.participants[0]!.botId] },
      { type: "chat.list.request", requestId: "r2" },
      {
        type: "chat.participant.add.request",
        requestId: "r3",
        chatId: chat.id,
        botId: "bot_x",
      },
      {
        type: "chat.participant.remove.request",
        requestId: "r4",
        chatId: chat.id,
        botId: "bot_x",
      },
      { type: "chat.message.send.request", requestId: "r5", chatId: chat.id, text: "hi" },
      { type: "chat.transcript.fetch.request", requestId: "r6", chatId: chat.id },
      { type: "chat.archive.request", requestId: "r7", chatId: chat.id },
      { type: "chat.session.reset.request", requestId: "r8", chatId: chat.id, botId: "bot_x" },
    ];
    for (const request of requests) {
      expect(SessionInboundMessageSchema.parse(request)).toMatchObject({ type: request.type });
    }
  });

  test("accepts the optional create and paging fields", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "chat.create.request",
        requestId: "r1",
        botIds: ["bot_a", "bot_b"],
        title: "Pair",
        rules: { interaction: { requireMention: true }, hops: { max: 1 } },
        firstMessage: { text: "hello", messageId: "cm_1" },
      }),
    ).toMatchObject({ firstMessage: { messageId: "cm_1" } });
    expect(
      SessionInboundMessageSchema.parse({
        type: "chat.transcript.fetch.request",
        requestId: "r6",
        chatId: chat.id,
        direction: "before",
        cursor: { seq: 40 },
        limit: 0,
      }),
    ).toMatchObject({ direction: "before", cursor: { seq: 40 }, limit: 0 });
    expect(() =>
      SessionInboundMessageSchema.parse({
        type: "chat.transcript.fetch.request",
        requestId: "r6",
        chatId: chat.id,
        direction: "sideways",
      }),
    ).toThrow();
  });

  test("parses each response and the pushes", () => {
    const responses = [
      {
        type: "chat.create.response",
        payload: {
          requestId: "r1",
          chat,
          sent: { messageId: "cm_1", seq: 1, targets: [chat.participants[0]!.botId] },
          error: null,
        },
      },
      { type: "chat.list.response", payload: { requestId: "r2", chats: [chat], error: null } },
      { type: "chat.participant.add.response", payload: { requestId: "r3", chat, error: null } },
      {
        type: "chat.participant.remove.response",
        payload: { requestId: "r4", chat: null, error: "gone", errorCode: "chat_not_found" },
      },
      {
        type: "chat.message.send.response",
        payload: {
          requestId: "r5",
          messageId: "cm_2",
          seq: 2,
          targets: [],
          duplicate: true,
          error: null,
        },
      },
      {
        type: "chat.transcript.fetch.response",
        payload: {
          requestId: "r6",
          lines: [line],
          hasOlder: false,
          hasNewer: false,
          startSeq: 1,
          endSeq: 1,
          error: null,
        },
      },
      { type: "chat.archive.response", payload: { requestId: "r7", chat, error: null } },
      {
        type: "chat.session.reset.response",
        payload: { requestId: "r8", chatId: chat.id, botId: "bot_x", error: null },
      },
      { type: "chat.transcript.appended", payload: { chatId: chat.id, line } },
      { type: "chat.updated", payload: { chat } },
    ];
    for (const response of responses) {
      expect(SessionOutboundMessageSchema.parse(response)).toMatchObject({ type: response.type });
    }
  });

  test("the pushes are subscribable session events", () => {
    expect(SessionEventSubscriptionSchema.parse("chat.transcript.appended")).toBe(
      "chat.transcript.appended",
    );
    expect(SessionEventSubscriptionSchema.parse("chat.updated")).toBe("chat.updated");
  });
});
