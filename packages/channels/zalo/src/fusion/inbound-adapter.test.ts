import { describe, expect, it } from "vitest";
import type { ZaloUpdate } from "../api.js";
import { buildZaloInboundEvent, resolveZaloTimestampMs, wasZaloBotMentioned } from "./inbound-adapter.js";

function textUpdate(overrides?: {
  text?: string;
  chatType?: "PRIVATE" | "GROUP";
  fromId?: string;
  isBot?: boolean;
}): ZaloUpdate {
  return {
    event_name: "message.text.received",
    message: {
      message_id: "m-1",
      from: {
        id: overrides?.fromId ?? "user-1",
        name: "User One",
        display_name: "User One",
        ...(overrides?.isBot === undefined ? {} : { is_bot: overrides.isBot }),
      },
      chat: { id: "chat-1", chat_type: overrides?.chatType ?? "PRIVATE" },
      date: 1_700_000_000,
      text: overrides?.text ?? "hello there",
    },
  };
}

describe("buildZaloInboundEvent", () => {
  it("normalizes a direct text message into a message turn", () => {
    const build = buildZaloInboundEvent(textUpdate(), { accountId: "default" });
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event).toMatchObject({
      channel: "zalo",
      externalEventId: "m-1",
      externalMessageId: "m-1",
      externalConversationId: "chat-1",
      chatType: "direct",
      senderId: "user-1",
      senderName: "User One",
      body: "hello there",
      wasMentioned: true,
      replyTo: "chat-1",
      kind: "message",
    });
    // Zalo sends seconds; the ctxPayload timestamp is milliseconds.
    expect(build.event.timestampMs).toBe(1_700_000_000_000);
  });

  it("classifies a leading /verb as a command with its args", () => {
    const build = buildZaloInboundEvent(textUpdate({ text: "/Status  now please" }), {
      accountId: "default",
    });
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event.kind).toBe("command");
    expect(build.event.facts?.command).toEqual({ name: "status", args: "now please" });
  });

  it("only marks a group message mentioned when it names the bot", () => {
    const params = { accountId: "default", botNames: ["Clisbot"] };
    const plain = buildZaloInboundEvent(
      textUpdate({ chatType: "GROUP", text: "unrelated chatter" }),
      params,
    );
    const addressed = buildZaloInboundEvent(
      textUpdate({ chatType: "GROUP", text: "@clisbot ping" }),
      params,
    );
    expect(plain.admit && plain.event.wasMentioned).toBe(false);
    expect(addressed.admit && addressed.event.wasMentioned).toBe(true);
    expect(addressed.admit && addressed.event.chatType).toBe("group");
  });

  it("carries an image caption as the body and the photo url for admission", () => {
    const build = buildZaloInboundEvent(
      {
        event_name: "message.image.received",
        message: {
          message_id: "m-2",
          from: { id: "user-1" },
          chat: { id: "chat-1", chat_type: "PRIVATE" },
          date: 1_700_000_000,
          caption: "look",
          photo_url: "https://cdn.example.com/a.jpg",
        },
      },
      { accountId: "default" },
    );
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event.body).toBe("look");
    expect(build.mediaUrl).toBe("https://cdn.example.com/a.jpg");
  });

  it("admits a captionless image, because the photo is the message", () => {
    const build = buildZaloInboundEvent(
      {
        event_name: "message.image.received",
        message: {
          message_id: "m-3",
          from: { id: "user-1" },
          chat: { id: "chat-1", chat_type: "PRIVATE" },
          date: 1_700_000_000,
          photo_url: "https://cdn.example.com/b.jpg",
        },
      },
      { accountId: "default" },
    );
    expect(build.admit).toBe(true);
  });

  it("skips sticker and unsupported events, as upstream does", () => {
    for (const event_name of [
      "message.sticker.received",
      "message.unsupported.received",
    ] as const) {
      const build = buildZaloInboundEvent(
        {
          event_name,
          message: {
            message_id: "m-4",
            from: { id: "user-1" },
            chat: { id: "chat-1", chat_type: "PRIVATE" },
            date: 1,
            sticker: "s-1",
          },
        },
        { accountId: "default" },
      );
      expect(build).toEqual({ admit: false, reason: "unsupported-event" });
    }
  });

  it("filters the bot's own message and bot authors unless allowBots", () => {
    expect(
      buildZaloInboundEvent(textUpdate({ fromId: "bot-1" }), {
        accountId: "default",
        botId: "bot-1",
      }),
    ).toEqual({ admit: false, reason: "own-message" });
    expect(
      buildZaloInboundEvent(textUpdate({ isBot: true }), { accountId: "default" }),
    ).toEqual({ admit: false, reason: "bot-message" });
    const allowed = buildZaloInboundEvent(textUpdate({ isBot: true }), {
      accountId: "default",
      allowBots: true,
    });
    expect(allowed.admit).toBe(true);
  });

  it("skips an empty body", () => {
    expect(buildZaloInboundEvent(textUpdate({ text: "   " }), { accountId: "default" })).toEqual({
      admit: false,
      reason: "empty-body",
    });
  });
});

describe("wasZaloBotMentioned", () => {
  it("matches @name and a bare name on a word boundary only", () => {
    expect(wasZaloBotMentioned("hey @clisbot", ["Clisbot"])).toBe(true);
    expect(wasZaloBotMentioned("hey clisbot, hi", ["clisbot"])).toBe(true);
    expect(wasZaloBotMentioned("clisbotanical garden", ["clisbot"])).toBe(false);
    expect(wasZaloBotMentioned("anything", [])).toBe(false);
  });
});

describe("resolveZaloTimestampMs", () => {
  it("passes milliseconds through and scales seconds", () => {
    expect(resolveZaloTimestampMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(resolveZaloTimestampMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(resolveZaloTimestampMs(undefined)).toBeUndefined();
  });
});
