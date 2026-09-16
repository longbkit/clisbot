import { describe, expect, it } from "vitest";
import {
  channelSessionLinks,
  channelSessionLinkText,
  commandReplyAddress,
} from "./commands-context.js";
import type { InboundMessage } from "./plane/types.js";

const message: InboundMessage = {
  channel: "slack",
  accountId: "work",
  senderIdentity: "slack:U123",
  text: "/cowork",
  mentionedBot: true,
  conversation: { kind: "channel", id: "C123", rootConversationId: "C123", threadId: "123.456" },
};

describe("command replies", () => {
  it("answers in the conversation and thread the command came from", () => {
    expect(commandReplyAddress(message)).toEqual({ to: "C123", threadId: "123.456" });
    expect(
      commandReplyAddress({ ...message, channel: "telegram", senderIdentity: "telegram:123" }),
    ).toEqual({ to: "C123", threadId: "123.456" });
  });
  it("answers a DM without a thread", () => {
    expect(
      commandReplyAddress({
        ...message,
        conversation: { ...message.conversation, kind: "dm", threadId: null },
      }),
    ).toEqual({ to: "C123" });
  });
  it("uses the host identity and escapes path segments for both app and web links", () => {
    expect(channelSessionLinks("host/name", "agent id")).toEqual({
      app: "paseo://h/host%2Fname/agent/agent%20id",
    });
    expect(channelSessionLinks("host", "agent", "https://app.example.test/base")).toEqual({
      app: "https://app.example.test/api/open/agent/agent?host=host",
      web: "https://app.example.test/h/host/agent/agent",
    });
    expect(channelSessionLinks(undefined, "agent")).toBeUndefined();
    expect(() => channelSessionLinks("host", "agent", "javascript:bad")).toThrow();
  });
  it("labels both destinations, and only embeds a link a channel will render", () => {
    expect(
      channelSessionLinkText({
        app: "https://app.test/api/open/agent/a?host=host",
        web: "https://app.test/h/host/agent/a",
      }),
    ).toBe(
      "[Open in the web app](https://app.test/h/host/agent/a)\n[Open in the Clisbot app](https://app.test/api/open/agent/a?host=host)",
    );
    expect(channelSessionLinkText({ app: "paseo://h/host/agent/a" })).toBe(
      "Open in the Clisbot app: paseo://h/host/agent/a",
    );
  });
});
