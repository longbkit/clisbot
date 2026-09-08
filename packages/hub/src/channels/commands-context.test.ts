import { describe, expect, it } from "vitest";
import { channelSessionLink, commandReplyAddress } from "./commands-context.js";
import type { InboundMessage } from "./plane/types.js";

const message: InboundMessage = {
  channel: "slack",
  accountId: "work",
  senderIdentity: "slack:U123",
  text: "/cowork",
  mentionedBot: true,
  conversation: { kind: "channel", id: "C123", rootConversationId: "C123", threadId: "123.456" },
};

describe("private command replies", () => {
  it("keeps links and identity out of public conversations but acknowledges turn control there", () => {
    expect(commandReplyAddress(message, "cowork")).toEqual({ to: "user:U123" });
    expect(commandReplyAddress(message, "me")).toEqual({ to: "user:U123" });
    expect(commandReplyAddress(message, "stop")).toEqual({ to: "C123", threadId: "123.456" });
    expect(
      commandReplyAddress(
        { ...message, channel: "telegram", senderIdentity: "telegram:123" },
        "status",
      ),
    ).toEqual({ to: "123" });
  });
  it("retains an existing DM location", () => {
    expect(
      commandReplyAddress(
        { ...message, conversation: { ...message.conversation, kind: "dm", threadId: null } },
        "cowork",
      ),
    ).toEqual({ to: "C123" });
  });
  it("uses the host identity and escapes path segments for both app and web links", () => {
    expect(channelSessionLink("host/name", "agent id")).toBe(
      "paseo://h/host%2Fname/agent/agent%20id",
    );
    expect(channelSessionLink("host", "agent", "https://app.example.test/base")).toBe(
      "https://app.example.test/h/host/agent/agent",
    );
    expect(channelSessionLink(undefined, "agent")).toBeUndefined();
    expect(() => channelSessionLink("host", "agent", "javascript:bad")).toThrow();
  });
});
