import { expect, test } from "vitest";
import { chatResourceActions } from "./chat-resource-actions";

const ids = (input: Parameters<typeof chatResourceActions>[0]) =>
  chatResourceActions(input).map((action) => action.id);

test("a group offers pin, group settings and archive in that order", () => {
  expect(ids({ target: "group", pinned: false })).toEqual(["pin", "group-settings", "archive"]);
  expect(chatResourceActions({ target: "group", pinned: true })[0]).toMatchObject({
    label: "Unpin",
    pinned: true,
  });
});

test("a direct chat offers bot settings only with configuration authority", () => {
  expect(ids({ target: "direct", pinned: false, canConfigureBot: true })).toEqual([
    "pin",
    "bot-settings",
    "archive",
  ]);
  expect(ids({ target: "direct", pinned: false })).toEqual(["pin", "archive"]);
});

test("a Bot row never archives", () => {
  expect(ids({ target: "bot", pinned: false, canConfigureBot: true })).toEqual([
    "pin",
    "bot-settings",
  ]);
});
