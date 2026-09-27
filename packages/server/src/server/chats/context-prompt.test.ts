import { describe, expect, test } from "vitest";
import type { ChatMessagePayload } from "@getpaseo/protocol/chats/types";
import { CONTEXT_HEADER, MESSAGE_HEADER } from "@getpaseo/protocol/conversation-prompt";
import { renderChatPrompt, senderLineOf, sessionTitleFor } from "./context-prompt.js";

const bots: Record<string, { slug: string; displayName: string }> = {
  bot_a: { slug: "researcher", displayName: "Researcher" },
  bot_b: { slug: "writer", displayName: "Writer" },
};
const botOf = (botId: string) => bots[botId] ?? null;

let seq = 0;
function line(sender: ChatMessagePayload["sender"], text: string, hop = 0): ChatMessagePayload {
  seq += 1;
  return { id: `m${seq}`, seq, at: "2026-09-26T00:00:00.000Z", sender, text, hop };
}
const actor = { kind: "user" as const, id: "usr_1", displayName: "Long Luong" };

describe("senderLineOf", () => {
  test("labels a user by actor, a bot by slug, and the system bare", () => {
    expect(senderLineOf(line({ kind: "user", actor }, "hi"), botOf)).toEqual({
      senderIdentity: "user:usr_1",
      senderName: "Long Luong",
      text: "hi",
    });
    expect(senderLineOf(line({ kind: "user" }, "hi"), botOf)).toEqual({
      senderIdentity: "user",
      senderName: undefined,
      text: "hi",
    });
    expect(senderLineOf(line({ kind: "bot", botId: "bot_a" }, "found it"), botOf)).toEqual({
      senderIdentity: "bot:researcher",
      senderName: "Researcher",
      text: "found it",
    });
    expect(senderLineOf(line({ kind: "bot", botId: "bot_gone" }, "x"), botOf)).toEqual({
      senderIdentity: "bot:bot_gone",
      senderName: undefined,
      text: "x",
    });
    expect(senderLineOf(line({ kind: "system" }, "⚠️ note"), botOf)).toEqual({
      senderIdentity: "system",
      text: "⚠️ note",
    });
  });
});

describe("renderChatPrompt", () => {
  test("a first message with no context is one sender line", () => {
    const trigger = line({ kind: "user", actor }, "Find the spec");
    expect(
      renderChatPrompt({ botId: "bot_a", window: [trigger], triggering: [trigger], botOf }),
    ).toBe("Long Luong (user:usr_1): Find the spec");
  });

  test("earlier user and other-bot lines are context; own identity is excluded", () => {
    const earlier = line({ kind: "user", actor }, "Any update?");
    const own = line({ kind: "bot", botId: "bot_a" }, "Still looking", 1);
    const other = line({ kind: "bot", botId: "bot_b" }, "@researcher I drafted the intro", 1);
    const trigger = line({ kind: "user", actor }, "@researcher status");
    expect(
      renderChatPrompt({
        botId: "bot_a",
        window: [earlier, own, other, trigger],
        triggering: [trigger],
        botOf,
      }),
    ).toBe(
      [
        CONTEXT_HEADER,
        "Long Luong (user:usr_1): Any update?",
        "Writer (bot:writer): @researcher I drafted the intro",
        MESSAGE_HEADER,
        "Long Luong (user:usr_1): @researcher status",
      ].join("\n"),
    );
  });

  test("a bot's own line is never the message, and a trigger outside the window still renders", () => {
    const own = line({ kind: "bot", botId: "bot_a" }, "done", 1);
    const cut = line({ kind: "user", actor }, "first");
    const kept = line({ kind: "user", actor }, "second");
    expect(renderChatPrompt({ botId: "bot_a", window: [own], triggering: [own], botOf })).toBe("");
    expect(
      renderChatPrompt({ botId: "bot_a", window: [kept], triggering: [cut, kept], botOf }),
    ).toBe(["Long Luong (user:usr_1): first", "Long Luong (user:usr_1): second"].join("\n"));
  });
});

describe("sessionTitleFor", () => {
  test("prefers the chat title, else the first line of the text, cut like the daemon does", () => {
    expect(sessionTitleFor("Research sync", "ignored")).toBe("Research sync");
    expect(sessionTitleFor(null, "\n  Fix   the login\nmore")).toBe("Fix the login");
    expect(sessionTitleFor(null, "x".repeat(80))).toBe("x".repeat(60));
    expect(sessionTitleFor(null, "  \n ")).toBeUndefined();
  });
});

test("self filtering uses stable Bot identity, not equal names or identical text", () => {
  const own = line({ kind: "bot", botId: "bot_a" }, "same reply");
  const other = line({ kind: "bot", botId: "bot_b" }, "same reply");
  const trigger = line({ kind: "user" }, "continue");
  const prompt = renderChatPrompt({
    botId: "bot_a",
    window: [own, other, trigger],
    triggering: [trigger],
    botOf: () => ({ slug: "same", displayName: "Same" }),
  });
  expect(prompt.match(/same reply/g)).toHaveLength(1);
  expect(prompt).toContain("Same (bot:same): same reply");
});
