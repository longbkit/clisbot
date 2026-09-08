import { describe, expect, it } from "vitest";
import {
  buildFeishuBotMemberEvent,
  buildFeishuCardActionEvent,
  buildFeishuInboundEvent,
} from "./inbound-adapter.js";
import type { FeishuMessageEvent } from "../event-types.js";

const BOT_OPEN_ID = "ou_bot";

function messageEvent(overrides: Partial<FeishuMessageEvent["message"]> = {}, senderType = "user") {
  return {
    sender: { sender_id: { open_id: "ou_sender" }, sender_type: senderType },
    message: {
      message_id: "om_1",
      chat_id: "oc_1",
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text: "hello" }),
      create_time: "1757000000000",
      ...overrides,
    },
  } as FeishuMessageEvent;
}

describe("buildFeishuInboundEvent", () => {
  it("normalizes a group text message", () => {
    const build = buildFeishuInboundEvent(messageEvent(), {
      accountId: "default",
      botOpenId: BOT_OPEN_ID,
    });
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event).toMatchObject({
      channel: "feishu",
      externalMessageId: "om_1",
      externalConversationId: "oc_1",
      chatType: "group",
      senderId: "ou_sender",
      body: "hello",
      wasMentioned: false,
      kind: "message",
      timestampMs: 1757000000000,
    });
  });

  it("maps p2p to direct and carries the thread id", () => {
    const build = buildFeishuInboundEvent(
      messageEvent({ chat_type: "p2p", thread_id: "omt_9" }),
      { accountId: "default", botOpenId: BOT_OPEN_ID },
    );
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event.chatType).toBe("direct");
    expect(build.event.messageThreadId).toBe("omt_9");
  });

  it("strips the bot mention and reports wasMentioned", () => {
    const build = buildFeishuInboundEvent(
      messageEvent({
        content: JSON.stringify({ text: "@_user_1 ping" }),
        mentions: [{ key: "@_user_1", id: { open_id: BOT_OPEN_ID }, name: "bot" }],
      }),
      { accountId: "default", botOpenId: BOT_OPEN_ID },
    );
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event.wasMentioned).toBe(true);
    expect(build.event.body).toBe("ping");
  });

  it("skips the bot's own message", () => {
    const event = messageEvent();
    event.sender.sender_id.open_id = BOT_OPEN_ID;
    const build = buildFeishuInboundEvent(event, {
      accountId: "default",
      botOpenId: BOT_OPEN_ID,
    });
    expect(build).toEqual({ admit: false, reason: "own-message" });
  });

  it("skips another bot's message unless allowBots", () => {
    const blocked = buildFeishuInboundEvent(messageEvent({}, "bot"), {
      accountId: "default",
      botOpenId: BOT_OPEN_ID,
    });
    expect(blocked).toEqual({ admit: false, reason: "bot-message" });
    const allowed = buildFeishuInboundEvent(messageEvent({}, "bot"), {
      accountId: "default",
      botOpenId: BOT_OPEN_ID,
      allowBots: true,
    });
    expect(allowed.admit).toBe(true);
  });

  it("skips an empty text message", () => {
    const build = buildFeishuInboundEvent(
      messageEvent({ content: JSON.stringify({ text: "   " }) }),
      { accountId: "default", botOpenId: BOT_OPEN_ID },
    );
    expect(build).toEqual({ admit: false, reason: "empty-body" });
  });

  it("admits a media message with no text", () => {
    const build = buildFeishuInboundEvent(
      messageEvent({ message_type: "image", content: JSON.stringify({ image_key: "img_1" }) }),
      { accountId: "default", botOpenId: BOT_OPEN_ID },
    );
    expect(build.admit).toBe(true);
  });
});

describe("buildFeishuCardActionEvent", () => {
  it("decodes a structured interaction envelope into a callback event", () => {
    const build = buildFeishuCardActionEvent(
      {
        operator: { open_id: "ou_clicker" },
        action: { value: { oc: "ocf1", k: "button", a: "approve", q: "yes" } },
        context: { chat_id: "oc_1", open_message_id: "om_card" },
      },
      { accountId: "default", botOpenId: BOT_OPEN_ID },
      1757000000000,
    );
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event.kind).toBe("callback");
    expect(build.event.wasMentioned).toBe(true);
    expect(build.event.facts?.callback).toMatchObject({
      actionId: "approve",
      value: "yes",
      actorId: "ou_clicker",
      messageId: "om_card",
    });
  });

  it("skips a message payload with no sender instead of throwing", () => {
    // The event body is cast, not validated: a payload missing `sender` used to
    // throw out of the handler, which answered 5xx — and Lark redelivers a 5xx
    // forever for a body that can never parse.
    const build = buildFeishuInboundEvent(
      { message: { message_id: "om_1", chat_id: "oc_1" } } as unknown as FeishuMessageEvent,
      { accountId: "default", botOpenId: BOT_OPEN_ID },
    );
    expect(build).toEqual({ admit: false, reason: "malformed-payload" });
  });

  it("skips a message payload whose sender carries no sender_id", () => {
    const build = buildFeishuInboundEvent(
      {
        sender: { sender_type: "user" },
        message: { message_id: "om_1", chat_id: "oc_1" },
      } as unknown as FeishuMessageEvent,
      { accountId: "default", botOpenId: BOT_OPEN_ID },
    );
    expect(build).toEqual({ admit: false, reason: "malformed-payload" });
  });

  it("skips a card action with no context", () => {
    const build = buildFeishuCardActionEvent(
      { action: { value: {} } } as unknown as Parameters<typeof buildFeishuCardActionEvent>[0],
      { accountId: "default" },
    );
    expect(build).toEqual({ admit: false, reason: "malformed-payload" });
  });

  it("refuses a card action with no chat", () => {
    const build = buildFeishuCardActionEvent(
      { operator: { open_id: "ou_x" }, action: { value: {} }, context: {} },
      { accountId: "default" },
    );
    expect(build).toEqual({ admit: false, reason: "not-a-turn-event" });
  });
});

describe("buildFeishuBotMemberEvent", () => {
  it("reports the bot joining a chat", () => {
    const build = buildFeishuBotMemberEvent(
      { chat_id: "oc_1", operator_id: { open_id: "ou_admin" }, external: false },
      true,
      1757000000000,
    );
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event.kind).toBe("member");
    expect(build.event.facts?.member).toEqual({ userId: "ou_admin", joined: true });
  });
});

it("does not treat an @all broadcast before a command as addressing the bot", () => {
  const build = buildFeishuInboundEvent(messageEvent({
    content: JSON.stringify({ text: "@_all /status" }),
    mentions: [{ key: "@_all", id: { open_id: "all" }, name: "all" }],
  }), { accountId: "default", botOpenId: BOT_OPEN_ID });
  expect(build.admit).toBe(true);
  if (!build.admit) return;
  expect(build.event.wasMentioned).toBe(false);
  expect(build.event.body).toContain('<at user_id="all">');
});
