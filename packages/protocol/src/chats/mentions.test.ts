import { expect, test } from "vitest";
import { isRoomWideMention, mentionTokens } from "./mentions.js";

test("mentionTokens gives each @token with the range of the whole mention", () => {
  const text = "hi @cto, ask @everyone";
  expect(mentionTokens(text)).toEqual([
    { token: "cto", start: 3, end: 7 },
    { token: "everyone", start: 13, end: 22 },
  ]);
  expect(text.slice(3, 7)).toBe("@cto");
});

test("room-wide mentions are everyone, all and here, in any case", () => {
  expect(["everyone", "ALL", "Here"].every(isRoomWideMention)).toBe(true);
  expect(isRoomWideMention("everyones")).toBe(false);
  expect(mentionTokens("mail a@all.dev")).toEqual([]);
});
