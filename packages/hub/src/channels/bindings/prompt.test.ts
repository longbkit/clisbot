import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { channelMessageId } from "../daemon/session-operation.js";
import type { InboundMessage } from "../plane/types.js";
import {
  CONTEXT_HEADER,
  MESSAGE_HEADER,
  deliveryMessageId,
  renderConversationPrompt,
  senderLabel,
  sessionTitle,
} from "./prompt.js";

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: "slack",
    accountId: "work",
    senderIdentity: "slack:U018WR2K090",
    senderName: "Minh Dương",
    text: "Create a CS card",
    mentionedBot: true,
    externalMessageId: "1712000000.000100",
    conversation: { kind: "channel", id: "C0APP", rootConversationId: "C0APP", threadId: null },
    ...overrides,
  };
}

describe("renderConversationPrompt", () => {
  it("names the sender of every line, and the identity alone when no name is known", () => {
    assert.equal(
      renderConversationPrompt({ context: [], messages: [message()] }),
      "Minh Dương (slack:U018WR2K090): Create a CS card",
    );
    const { senderName: _unnamed, ...anonymous } = message({ text: "hi" });
    assert.equal(
      renderConversationPrompt({ context: [], messages: [anonymous] }),
      "slack:U018WR2K090: hi",
    );
  });

  it("puts the context before the message, marked as quoted context", () => {
    const lan = message({
      senderIdentity: "slack:U02ABC",
      senderName: "Lan Nguyễn",
      text: "code is HH-HT",
    });
    assert.equal(
      renderConversationPrompt({
        context: [lan],
        messages: [message({ text: "create the card" })],
      }),
      [
        CONTEXT_HEADER,
        "Lan Nguyễn (slack:U02ABC): code is HH-HT",
        MESSAGE_HEADER,
        "Minh Dương (slack:U018WR2K090): create the card",
      ].join("\n"),
    );
  });

  it("adds the handle after the identity when the platform has one", () => {
    assert.equal(
      renderConversationPrompt({
        context: [],
        messages: [message({ senderUsername: "minh.duong", text: "hi" })],
      }),
      "Minh Dương (slack:U018WR2K090, @minh.duong): hi",
    );
    const { senderName: _unnamed, ...anonymous } = message({ senderUsername: "minh.duong" });
    assert.equal(senderLabel(anonymous), "slack:U018WR2K090");
  });
});

describe("deliveryMessageId", () => {
  it("keeps one message's own receipt key, whatever path sends it", () => {
    assert.equal(deliveryMessageId([message()]), channelMessageId(message()));
  });

  it("keys a batch by its messages, in order", () => {
    const first = message({ externalMessageId: "1712000000.000100" });
    const second = message({ externalMessageId: "1712000000.000200" });
    const batch = deliveryMessageId([first, second]);
    assert.equal(deliveryMessageId([first, second]), batch, "a replay is the same request");
    assert.notEqual(deliveryMessageId([second, first]), batch);
    assert.notEqual(batch, channelMessageId(first));
    assert.notEqual(batch, channelMessageId(second));
  });
});

describe("sessionTitle", () => {
  it("is the trigger's first line, as the daemon names a bare prompt", () => {
    assert.equal(sessionTitle("\n  Fix   the login\nmore detail"), "Fix the login");
    assert.equal(sessionTitle("x".repeat(80)), "x".repeat(60));
    assert.equal(sessionTitle("  \n "), undefined);
  });
});
