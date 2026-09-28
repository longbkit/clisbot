import { expect, it } from "vitest";
import { filterDirectoryBots } from "./directory-model";
import type { BotsSidebarBot } from "./bots-section";
const bots: BotsSidebarBot[] = [
  {
    key: "a:one",
    botId: "one",
    serverId: "a",
    name: "Zulu",
    hostName: "Laptop",
    description: "Research reports",
    updatedAt: "2026-09-28",
  },
  {
    key: "b:two",
    botId: "two",
    serverId: "b",
    name: "Alpha",
    hostName: "Server",
    updatedAt: "2026-09-27",
  },
  { key: "a:three", botId: "three", serverId: "a", name: "Beta", hostName: "Laptop" },
];
it("filters across full metadata and a specific Host without mutating the source", () => {
  expect(filterDirectoryBots(bots, "reports", "a", "name").map((b) => b.key)).toEqual(["a:one"]);
  expect(filterDirectoryBots(bots, "Laptop", "b", "recent")).toEqual([]);
  expect(filterDirectoryBots(bots, "", "a", "name").map((b) => b.name)).toEqual(["Beta", "Zulu"]);
  expect(bots[0]?.name).toBe("Zulu");
});
it("switches Recent/Name deterministically and handles no results", () => {
  expect(filterDirectoryBots(bots, "", "", "recent").map((b) => b.name)).toEqual([
    "Zulu",
    "Alpha",
    "Beta",
  ]);
  expect(filterDirectoryBots(bots, "", "", "name").map((b) => b.name)).toEqual([
    "Alpha",
    "Beta",
    "Zulu",
  ]);
  expect(filterDirectoryBots(bots, "absent", "", "recent")).toEqual([]);
});
it("uses explicit viewer ownership and keeps unknown Hosts in All only", () => {
  const catalog = [
    { ...bots[0]!, isOwner: true, canConfigure: false },
    { ...bots[1]!, isOwner: false, canConfigure: true },
    { ...bots[2]!, canConfigure: true },
  ];
  expect(filterDirectoryBots(catalog, "", "", "recent", "all")).toHaveLength(3);
  expect(filterDirectoryBots(catalog, "", "", "recent", "mine").map((b) => b.key)).toEqual([
    "a:one",
  ]);
  expect(filterDirectoryBots(catalog, "", "", "recent", "shared").map((b) => b.key)).toEqual([
    "b:two",
  ]);
  expect(filterDirectoryBots(catalog, "", "a", "recent", "shared")).toEqual([]);
});
