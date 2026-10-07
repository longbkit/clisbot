import { expect, test } from "vitest";
import { chatResourceActions } from "./chat-resource-actions";

const ids = (input: Parameters<typeof chatResourceActions>[0]) =>
  chatResourceActions(input).map((action) => action.id);

test("a group offers group settings, Members, then pin and archive last", () => {
  expect(ids({ target: "group", pinned: false })).toEqual([
    "group-settings",
    "members",
    "pin",
    "archive",
  ]);
  expect(chatResourceActions({ target: "group", pinned: true })[2]).toMatchObject({
    label: "Unpin",
    pinned: true,
  });
});

test("a direct chat offers bot settings only with configuration authority", () => {
  expect(ids({ target: "direct", pinned: false, canConfigureBot: true })).toEqual([
    "bot-settings",
    "pin",
    "archive",
  ]);
  expect(ids({ target: "direct", pinned: false })).toEqual(["pin", "archive"]);
});

test("a Bot row never archives, so pin closes its list", () => {
  expect(ids({ target: "bot", pinned: false, canConfigureBot: true })).toEqual([
    "bot-settings",
    "pin",
  ]);
});

test("a Bot row and its DM offer Connect to a channel… after settings; a group never", () => {
  const input = { pinned: false, canConfigureBot: true, canConnectChannel: true };
  expect(ids({ target: "bot", ...input })).toEqual(["bot-settings", "connect-channel", "pin"]);
  expect(ids({ target: "direct", ...input })).toEqual([
    "bot-settings",
    "connect-channel",
    "pin",
    "archive",
  ]);
  expect(ids({ target: "group", ...input })).toEqual([
    "group-settings",
    "members",
    "pin",
    "archive",
  ]);
  expect(chatResourceActions({ target: "bot", ...input })[1]?.label).toBe("Connect to a channel…");
});

test("Connect to a channel… needs the authority to add a Route", () => {
  expect(ids({ target: "bot", pinned: false, canConnectChannel: false })).toEqual(["pin"]);
  expect(ids({ target: "direct", pinned: false, canConnectChannel: true })).toEqual([
    "connect-channel",
    "pin",
    "archive",
  ]);
});
