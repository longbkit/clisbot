import { describe, expect, test } from "bun:test";
import {
  getZaloPersonalMessageId,
  getZaloPersonalMessageSenderId,
  getZaloPersonalMessageText,
  hasZaloPersonalSelfMention,
} from "../../src/channels/zalo-personal/inbound-message.ts";
import type { ZaloPersonalInboundMessage } from "../../src/channels/zalo-personal/service-types.ts";

function buildMessage(overrides: Partial<ZaloPersonalInboundMessage> = {}) {
  return {
    threadId: "thread-1",
    type: 0,
    isSelf: false,
    data: {
      content: " hello ",
      msgId: "msg-1",
      cliMsgId: "cli-1",
      ts: 1779010000000,
      uidFrom: "user-1",
      mentions: [{ uid: "bot-1" }],
    },
    ...overrides,
  } as ZaloPersonalInboundMessage;
}

describe("zalo-personal inbound message normalization", () => {
  test("normalizes text, sender, id, and self mentions from zca-js message data", () => {
    const message = buildMessage();

    expect(getZaloPersonalMessageText(message)).toBe("hello");
    expect(getZaloPersonalMessageSenderId(message)).toBe("user-1");
    expect(getZaloPersonalMessageId(message)).toBe("msg-1");
    expect(hasZaloPersonalSelfMention(message, "bot-1")).toBe(true);
    expect(hasZaloPersonalSelfMention(message, "bot-2")).toBe(false);
  });

  test("strips explicit self mention from text used as prompt input", () => {
    const message = buildMessage({
      data: {
        content: " @bot hello",
        msgId: "msg-2",
        uidFrom: "user-1",
        mentions: [{ uid: "bot-1", pos: 1, len: 4 }],
      },
    } as Partial<ZaloPersonalInboundMessage>);

    expect(getZaloPersonalMessageText(message, "bot-1")).toBe("hello");
  });

  test("treats quoted bot replies as implicit self mentions", () => {
    const message = buildMessage({
      data: {
        content: "replying",
        msgId: "msg-3",
        uidFrom: "user-1",
        quote: { ownerId: "bot-1" },
      },
    } as Partial<ZaloPersonalInboundMessage>);

    expect(hasZaloPersonalSelfMention(message, "bot-1")).toBe(true);
  });

  test("normalizes object content into readable text when possible", () => {
    const message = buildMessage({
      data: {
        content: {
          title: "Shared link",
          description: "Example description",
          href: "https://example.test",
        },
        msgId: "msg-4",
        uidFrom: "user-1",
      },
    } as Partial<ZaloPersonalInboundMessage>);

    expect(getZaloPersonalMessageText(message)).toBe(
      "Shared link\nExample description\nhttps://example.test",
    );
  });

  test("falls back to thread and timestamp fields when provider ids are absent", () => {
    const message = buildMessage({
      threadId: "thread-2",
      data: {
        content: { href: "unsupported" },
        ts: 1779010000001,
      },
    } as Partial<ZaloPersonalInboundMessage>);

    expect(getZaloPersonalMessageText(message)).toBe("unsupported");
    expect(getZaloPersonalMessageSenderId(message)).toBe("thread-2");
    expect(getZaloPersonalMessageId(message)).toBe("thread-2:1779010000001");
  });
});
