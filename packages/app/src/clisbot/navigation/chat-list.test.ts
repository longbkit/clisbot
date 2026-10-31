import { describe, expect, it } from "vitest";
import {
  chatListItems,
  chatScopeCounts,
  holdOrder,
  orderChatList,
  type ChatListEntry,
} from "./chat-list";

function entry(key: string, overrides: Partial<ChatListEntry> = {}): ChatListEntry {
  return {
    key,
    kind: "bot",
    serverId: "h1",
    title: key,
    updatedAt: undefined,
    pinned: false,
    ownership: "mine",
    unread: false,
    company: false,
    ...overrides,
  };
}

const entries = [
  entry("nia", { updatedAt: "2026-10-25T09:41:00Z", pinned: true, pinIndex: 1 }),
  entry("dalat", { kind: "group", updatedAt: "2026-10-25T08:00:00Z", pinned: true, pinIndex: 0 }),
  entry("rin", { updatedAt: "2026-10-25T08:30:00Z", unread: true }),
  entry("ceo", { kind: "group", updatedAt: "2026-10-25T08:02:00Z", company: true }),
  entry("idle-bot"),
  entry("theirs", { updatedAt: "2026-10-25T10:00:00Z", ownership: "others" }),
];
const order = (list: ChatListEntry[]) => list.map((item) => item.key);

describe("orderChatList", () => {
  it("mixes DMs and groups newest first with pins on top in pin order", () => {
    const list = orderChatList({ entries, scope: "mine", chip: "all", search: "" });
    expect(order(list)).toEqual(["dalat", "nia", "rin", "ceo", "idle-bot"]);
  });

  it("filters by scope, chip and search", () => {
    expect(order(orderChatList({ entries, scope: "others", chip: "all", search: "" }))).toEqual([
      "theirs",
    ]);
    expect(order(orderChatList({ entries, scope: "all", chip: "groups", search: "" }))).toEqual([
      "dalat",
      "ceo",
    ]);
    expect(order(orderChatList({ entries, scope: "mine", chip: "unread", search: "" }))).toEqual([
      "rin",
    ]);
    expect(order(orderChatList({ entries, scope: "mine", chip: "company", search: "" }))).toEqual([
      "ceo",
    ]);
    expect(order(orderChatList({ entries, scope: "all", chip: "all", search: "RI" }))).toEqual([
      "rin",
    ]);
  });

  it("keeps rows still while held; new rows enter at the top", () => {
    const held = ["dalat", "nia", "rin", "ceo", "idle-bot"];
    const moved = entries.map((item) =>
      item.key === "ceo" ? { ...item, updatedAt: "2026-10-25T11:00:00Z" } : item,
    );
    const added = [...moved, entry("new", { updatedAt: "2026-10-25T07:00:00Z" })];
    const list = orderChatList({ entries: added, scope: "mine", chip: "all", search: "", held });
    expect(order(list)).toEqual(["new", ...held]);
    expect(order(holdOrder(["b", "a"], [entry("a"), entry("b")]))).toEqual(["b", "a"]);
  });

  it("counts scopes consistently", () => {
    expect(chatScopeCounts(entries)).toEqual({ mine: 5, others: 1, all: 6 });
    // A chat nobody can place counts as the reader's.
    expect(chatScopeCounts([...entries, entry("unplaced", { ownership: "unknown" })])).toEqual({
      mine: 6,
      others: 1,
      all: 7,
    });
  });
});

describe("Chats display options", () => {
  it("sorts by name and filters by Host", () => {
    const list = orderChatList({ entries, scope: "mine", chip: "all", search: "", sort: "name" });
    expect(order(list)).toEqual(["dalat", "nia", "ceo", "idle-bot", "rin"]);
    const elsewhere = [
      ...entries,
      entry("remote", { serverId: "h2", updatedAt: "2026-10-25T12:00:00Z" }),
    ];
    expect(
      order(
        orderChatList({
          entries: elsewhere,
          scope: "mine",
          chip: "all",
          search: "",
          serverIds: ["h2"],
        }),
      ),
    ).toEqual(["remote"]);
  });

  it("stays one mixed list unless the reader splits it", () => {
    const ordered = orderChatList({ entries, scope: "mine", chip: "all", search: "" });
    expect(chatListItems(ordered, false).map((item) => item.key)).toEqual(order(ordered));
    expect(chatListItems(ordered, true).map((item) => item.key)).toEqual([
      "heading:bot",
      "nia",
      "rin",
      "idle-bot",
      "heading:group",
      "dalat",
      "ceo",
    ]);
  });
});
