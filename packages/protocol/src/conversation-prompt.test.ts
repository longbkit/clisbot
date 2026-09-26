import { describe, expect, test } from "vitest";
import {
  CONTEXT_HEADER,
  MESSAGE_HEADER,
  renderConversationPrompt,
  senderLabel,
  type ConversationLine,
} from "./conversation-prompt.js";

function line(overrides: Partial<ConversationLine> = {}): ConversationLine {
  return {
    senderIdentity: "slack:U018WR2K090",
    senderName: "Minh Dương",
    text: "Create a CS card",
    ...overrides,
  };
}

describe("renderConversationPrompt", () => {
  test("names the sender of every line, and the identity alone when no name is known", () => {
    expect(renderConversationPrompt({ context: [], messages: [line()] })).toBe(
      "Minh Dương (slack:U018WR2K090): Create a CS card",
    );
    const { senderName: _unnamed, ...anonymous } = line({ text: "hi" });
    expect(renderConversationPrompt({ context: [], messages: [anonymous] })).toBe(
      "slack:U018WR2K090: hi",
    );
  });

  test("puts the context before the message, marked as quoted context", () => {
    const lan = line({
      senderIdentity: "slack:U02ABC",
      senderName: "Lan Nguyễn",
      text: "code is HH-HT",
    });
    expect(
      renderConversationPrompt({ context: [lan], messages: [line({ text: "create the card" })] }),
    ).toBe(
      [
        CONTEXT_HEADER,
        "Lan Nguyễn (slack:U02ABC): code is HH-HT",
        MESSAGE_HEADER,
        "Minh Dương (slack:U018WR2K090): create the card",
      ].join("\n"),
    );
  });

  test("adds the handle after the identity when the platform has one", () => {
    expect(
      renderConversationPrompt({
        context: [],
        messages: [line({ senderUsername: "minh.duong", text: "hi" })],
      }),
    ).toBe("Minh Dương (slack:U018WR2K090, @minh.duong): hi");
    const { senderName: _unnamed, ...anonymous } = line({ senderUsername: "minh.duong" });
    expect(senderLabel(anonymous)).toBe("slack:U018WR2K090");
  });

  test("renders the daemon chat senders: a user with an actor, a bot, and the system", () => {
    expect(senderLabel({ senderIdentity: "user:usr_1", senderName: "Long Luong" })).toBe(
      "Long Luong (user:usr_1)",
    );
    expect(senderLabel({ senderIdentity: "bot:researcher", senderName: "Researcher" })).toBe(
      "Researcher (bot:researcher)",
    );
    expect(senderLabel({ senderIdentity: "system" })).toBe("system");
  });
});
