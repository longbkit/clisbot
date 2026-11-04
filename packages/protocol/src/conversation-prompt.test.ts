import { describe, expect, test } from "vitest";
import {
  CONTEXT_HEADER,
  MESSAGE_HEADER,
  THREAD_HEADER,
  conversationMessageText,
  renderConversationPrompt,
  senderLabel,
  type ConversationLine,
} from "./conversation-prompt.js";

function line(overrides: Partial<ConversationLine> = {}): ConversationLine {
  return {
    senderIdentity: "slack:U0000000001",
    senderName: "An Nguyễn",
    text: "Create a CS card",
    ...overrides,
  };
}

describe("renderConversationPrompt", () => {
  test("names the sender of every line, and the identity alone when no name is known", () => {
    expect(renderConversationPrompt({ context: [], messages: [line()] })).toBe(
      "An Nguyễn (slack:U0000000001): Create a CS card",
    );
    const { senderName: _unnamed, ...anonymous } = line({ text: "hi" });
    expect(renderConversationPrompt({ context: [], messages: [anonymous] })).toBe(
      "slack:U0000000001: hi",
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
        "An Nguyễn (slack:U0000000001): create the card",
      ].join("\n"),
    );
  });

  test("adds the handle after the identity when the platform has one", () => {
    expect(
      renderConversationPrompt({
        context: [],
        messages: [line({ senderUsername: "an.example", text: "hi" })],
      }),
    ).toBe("An Nguyễn (slack:U0000000001, @an.example): hi");
    const { senderName: _unnamed, ...anonymous } = line({ senderUsername: "an.example" });
    expect(senderLabel(anonymous)).toBe("slack:U0000000001");
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

describe("conversationMessageText", () => {
  test.each([
    ["user:owner: hi", "hi"],
    ["An Nguyễn (slack:U0000000001, @an.example): Create a CS card", "Create a CS card"],
    ["Long (user:owner): line one\nline two", "line one\nline two"],
    ["bot:cfo: check the numbers", "check the numbers"],
  ])("takes the sender line off %j", (prompt, text) => {
    expect(conversationMessageText(prompt)).toBe(text);
  });

  test("drops the quoted context", () => {
    const prompt = renderConversationPrompt({
      context: [line({ text: "code is HH-HT" })],
      messages: [line({ text: "create the card" })],
    });
    expect(conversationMessageText(prompt)).toBe("create the card");
  });

  test("keeps the lines of several senders, who said what is part of the message", () => {
    const prompt = renderConversationPrompt({
      context: [],
      messages: [
        line({ text: "one" }),
        line({ senderIdentity: "slack:U02ABC", senderName: "Lan", text: "two" }),
      ],
    });
    expect(conversationMessageText(prompt)).toBe(prompt);
  });

  test.each([
    "hi",
    "http://localhost:8081: refused",
    "Note: read this",
    "src/app.ts (line 4): fails",
    "user: hi",
  ])("leaves %j alone", (text) => {
    expect(conversationMessageText(text)).toBe(text);
  });
});

describe("the thread block", () => {
  const root = line({
    senderIdentity: "slack:B_ALERT",
    senderName: "Alertmanager",
    text: "[FIRING:2] Disk",
  });
  const reply = line({
    senderIdentity: "slack:U2",
    senderName: undefined,
    text: "seen this before",
  });
  const trigger = line({ text: "@bot free up the disk" });

  test("renders before the context, with notes as they are", () => {
    const prompt = renderConversationPrompt({
      thread: [root, { note: "(3 earlier replies are not shown.)" }, reply],
      context: [line({ text: "unmentioned" })],
      messages: [trigger],
    });
    expect(prompt.split("\n")).toEqual([
      THREAD_HEADER,
      "Alertmanager (slack:B_ALERT): [FIRING:2] Disk",
      "(3 earlier replies are not shown.)",
      "slack:U2: seen this before",
      CONTEXT_HEADER,
      "An Nguyễn (slack:U0000000001): unmentioned",
      MESSAGE_HEADER,
      "An Nguyễn (slack:U0000000001): @bot free up the disk",
    ]);
  });

  test("renders a thread without context", () => {
    expect(renderConversationPrompt({ thread: [root], context: [], messages: [trigger] })).toBe(
      [
        THREAD_HEADER,
        "Alertmanager (slack:B_ALERT): [FIRING:2] Disk",
        MESSAGE_HEADER,
        "An Nguyễn (slack:U0000000001): @bot free up the disk",
      ].join("\n"),
    );
  });

  test("an empty thread changes nothing", () => {
    expect(renderConversationPrompt({ thread: [], context: [], messages: [trigger] })).toBe(
      "An Nguyễn (slack:U0000000001): @bot free up the disk",
    );
  });

  test("history shows only what the person wrote", () => {
    const prompt = renderConversationPrompt({
      thread: [root, reply],
      context: [],
      messages: [trigger],
    });
    expect(conversationMessageText(prompt)).toBe("@bot free up the disk");
  });
});
