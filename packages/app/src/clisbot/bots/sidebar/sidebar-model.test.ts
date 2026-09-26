import { expect, it } from "vitest";
import type { HostTagged } from "../data/aggregate";
import type { BotPayload, ChatPayload } from "../data/contracts";
import {
  directChatForBot,
  isDirectChat,
  projectBotSidebar,
  selectedDirectBotKey,
} from "./sidebar-model";
const bot: HostTagged<BotPayload> = {
  id: "bot",
  name: "Helper",
  slug: "helper",
  kind: "team",
  cwd: "/helper",
  projectId: "p",
  workspaceId: "w",
  launchDefaults: { provider: "codex" },
  serverId: "host-a",
  serverName: "Host A",
  canConfigure: false,
};
function chat(id: string, kind: "direct" | "group", serverId = "host-a"): HostTagged<ChatPayload> {
  return {
    id,
    kind,
    serverId,
    serverName: serverId,
    title: id,
    participants: [{ botId: "bot", agentId: `${id}-agent` }],
    rules: {},
    createdAt: "2026-09-26",
    updatedAt: "2026-09-26",
  };
}
it("merges the personal DM into its bot and keeps one-member groups in Group chats", () => {
  const chats = [chat("dm", "direct"), chat("reduced-group", "group")];
  const rows = projectBotSidebar([bot], chats, false);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    chatId: "dm",
    agentId: "dm-agent",
    updatedAt: "2026-09-26",
    canConfigure: false,
  });
  expect(chats.filter((c) => !isDirectChat(c)).map((c) => c.id)).toEqual(["reduced-group"]);
});
it("never borrows another Host's DM and uses latest accessible DM for legacy duplicates", () => {
  const chats = [
    chat("other", "direct", "host-b"),
    chat("old", "direct"),
    { ...chat("latest", "direct"), updatedAt: "2026-09-27" },
  ];
  expect(directChatForBot(chats, "host-a", "bot")?.id).toBe("latest");
  expect(projectBotSidebar([bot], [chats[0]], true)[0]).toMatchObject({
    chatId: undefined,
    agentId: undefined,
    hostLabel: "Host A",
  });
});
it("does not infer configure permission from shared Bot kind", () => {
  expect(projectBotSidebar([{ ...bot, canConfigure: undefined }], [], false)[0].canConfigure).toBe(
    false,
  );
});

it("selects the Bot row for any of its accessible direct chats, but never a group", () => {
  const chats = [chat("dm", "direct"), chat("old-dm", "direct"), chat("group", "group")];
  expect(selectedDirectBotKey(chats, { serverId: "host-a", chatId: "old-dm" })).toBe("host-a:bot");
  expect(selectedDirectBotKey(chats, { serverId: "host-a", chatId: "group" })).toBeNull();
  expect(selectedDirectBotKey(chats, { serverId: "host-b", chatId: "dm" })).toBeNull();
});
