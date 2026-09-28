import { describe, expect, test } from "vitest";
import { parseMentions, parseMessageMentions } from "./mentions.js";

const participants = [
  { botId: "bot_a", slug: "alpha" },
  { botId: "bot_b", slug: "beta-2" },
];

describe("parseMentions", () => {
  test("finds a slug at the start, in the middle and at the end", () => {
    expect(parseMentions("@alpha look", participants)).toEqual(["bot_a"]);
    expect(parseMentions("hey @beta-2 and @alpha", participants)).toEqual(["bot_b", "bot_a"]);
    expect(parseMentions("done, thanks @alpha", participants)).toEqual(["bot_a"]);
  });

  test("stops at punctuation and does not span into it", () => {
    expect(parseMentions("@alpha, @beta-2: go (@alpha)", participants)).toEqual(["bot_a", "bot_b"]);
    expect(parseMentions("ask @alpha.", participants)).toEqual(["bot_a"]);
    expect(parseMentions("@beta-2's turn", participants)).toEqual(["bot_b"]);
  });

  test("an unknown slug, an email and a word-embedded @ are text", () => {
    expect(parseMentions("@gamma?", participants)).toEqual([]);
    expect(parseMentions("mail long@alpha.dev", participants)).toEqual([]);
    expect(parseMentions("@alphabet", participants)).toEqual([]);
    expect(parseMentions("@beta", participants)).toEqual([]);
  });

  test("each bot once, case-insensitively", () => {
    expect(parseMentions("@Alpha then @ALPHA again", participants)).toEqual(["bot_a"]);
  });
});

describe("parseMessageMentions", () => {
  const named = [
    { botId: "bot_a", slug: "head-of-product", displayName: "Head of Product" },
    { botId: "bot_b", slug: "cto", displayName: "CTO" },
  ];

  test("@everyone and its aliases address the room", () => {
    expect(parseMessageMentions("@everyone thoughts?", named)).toEqual({ botIds: [], room: true });
    expect(parseMessageMentions("@All go", named).room).toBe(true);
    expect(parseMessageMentions("@here and @cto", named)).toEqual({
      botIds: ["bot_b"],
      room: true,
    });
    expect(parseMessageMentions("mail me@here.dev", named).room).toBe(false);
  });

  test("display names count only when asked, in order of appearance", () => {
    const text = "@CTO then @Head of Product, please";
    expect(parseMessageMentions(text, named).botIds).toEqual(["bot_b"]);
    expect(parseMessageMentions(text, named, { displayNames: true }).botIds).toEqual([
      "bot_b",
      "bot_a",
    ]);
    expect(
      parseMessageMentions("@Head of Productivity", named, { displayNames: true }).botIds,
    ).toEqual([]);
  });
});
