import { expect, test } from "vitest";
import { applyMemberMention, displayMentions, memberMentionOptions } from "./member-mentions";

const members = [
  { slug: "head-of-product", displayName: "Head of Product" },
  { slug: "cto", displayName: "CTO" },
];

test("Everyone first, then members; a query matches slug or name", () => {
  expect(memberMentionOptions(members, "").map((option) => option.label)).toEqual([
    "@everyone",
    "Head of Product",
    "CTO",
  ]);
  expect(memberMentionOptions(members, "prod").map((option) => option.token)).toEqual([
    "head-of-product",
  ]);
  expect(memberMentionOptions(members, "ev").map((option) => option.token)).toEqual(["everyone"]);
  expect(memberMentionOptions(members.slice(0, 1), "")).toHaveLength(1);
});

test("applying a member replaces the typed query with the token and one space", () => {
  expect(applyMemberMention("ask @he", { start: 4, end: 7 }, "head-of-product")).toBe(
    "ask @head-of-product ",
  );
  expect(applyMemberMention("@c now", { start: 0, end: 2 }, "cto")).toBe("@cto now");
});

test("transcript lines show member names and the room token; unknown mentions stay", () => {
  const text = "@cto and @everyone, ask @nobody";
  expect(displayMentions(text, members, { markdown: false })).toBe(
    "@CTO and @everyone, ask @nobody",
  );
  expect(displayMentions("@head-of-product: go", members, { markdown: true })).toBe(
    "**@Head of Product**: go",
  );
});
