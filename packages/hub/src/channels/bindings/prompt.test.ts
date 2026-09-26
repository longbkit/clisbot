import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { channelMessageId } from "../daemon/session-operation.js";
import type { InboundMessage } from "../plane/types.js";
import { deliveryMessageId, renderConversationPrompt, sessionTitle } from "./prompt.js";

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
  // The rendering itself is covered in the protocol package
  // (`conversation-prompt.test.ts`); this proves an inbound message renders through it.
  it("renders an inbound channel message as a sender line", () => {
    assert.equal(
      renderConversationPrompt({ context: [], messages: [message()] }),
      "Minh Dương (slack:U018WR2K090): Create a CS card",
    );
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
