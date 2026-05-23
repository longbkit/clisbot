import { describe, expect, test } from "bun:test";
import { TextStyle } from "zca-js";
import { renderZaloPersonalMessage } from "../../src/channels/zalo-personal/message-render.ts";
import { clisbotConfigSchema } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import { runChannelNativeCli } from "../../src/control/commands/channel-native-cli.ts";
import { runContactsCli } from "../../src/control/commands/contacts-cli.ts";
import { runGroupsCli } from "../../src/control/commands/groups-cli.ts";

function createLoadedConfig() {
  const raw = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate())) as any;
  raw.bots.zaloPersonal.defaults.enabled = true;
  raw.bots.zaloPersonal.default = {
    enabled: true,
    credentialType: "tokenFile",
    tokenFile: "/tmp/zalo-session.json",
    directMessages: {},
    groups: {},
  };
  return {
    configPath: "/tmp/clisbot.json",
    processedEventsPath: "/tmp/events.json",
    stateDir: "/tmp/state",
    raw,
  };
}

function createDeps(api: Record<string, any>) {
  const output: string[] = [];
  return {
    output,
    deps: {
      loadConfig: async () => createLoadedConfig(),
      login: async () => ({
        api,
        ThreadType: { User: 0, Group: 1 },
      }),
      print: (text: string) => output.push(text),
      readFile: async () => Buffer.from("file"),
    },
  };
}

describe("zalo personal operator command surface", () => {
  test("renders markdown and mention placeholders into Zalo native payload parts", () => {
    expect(renderZaloPersonalMessage({
      text: "**Quan trọng** <@u1|Alice>\n- việc 1",
      inputFormat: "md",
      renderMode: "native",
    })).toMatchObject({
      text: "Quan trọng @Alice\nviệc 1",
      mentions: [{ uid: "u1", pos: 11, len: 6 }],
    });
  });

  test("zalo native markdown keeps code, math markers, and escapes literal", () => {
    expect(renderZaloPersonalMessage({
      text: "before `inline *code*` after\n2 * 3 * 4\n\\*literal\\*",
      inputFormat: "md",
      renderMode: "native",
    })).toEqual({
      text: "before `inline *code*` after\n2 * 3 * 4\n*literal*",
    });
  });

  test("zalo native markdown maps headings quotes lists and fenced code", () => {
    expect(renderZaloPersonalMessage({
      text: "# Title\n> quoted\n  - nested\n```ts\n*code*\n```",
      inputFormat: "md",
      renderMode: "native",
    })).toEqual({
      text: "Title\nquoted\nnested\n*code*",
      styles: [
        { start: 0, len: 5, st: TextStyle.Bold },
        { start: 0, len: 5, st: TextStyle.Big },
        { start: 6, len: 6, st: TextStyle.Indent, indentSize: 1 },
        { start: 13, len: 6, st: TextStyle.UnorderedList },
      ],
    });
  });

  test("zalo native markdown supports nested color and emphasis tags", () => {
    expect(renderZaloPersonalMessage({
      text: "**{red}x{/red}** {green}**y**{/green}",
      inputFormat: "md",
      renderMode: "native",
    })).toEqual({
      text: "x y",
      styles: [
        { start: 0, len: 1, st: TextStyle.Bold },
        { start: 0, len: 1, st: TextStyle.Red },
        { start: 2, len: 1, st: TextStyle.Green },
        { start: 2, len: 1, st: TextStyle.Bold },
      ],
    });
  });

  test("zalo native markdown remaps style ranges around mention placeholders", () => {
    expect(renderZaloPersonalMessage({
      text: "**<@u1|Alice> check**",
      inputFormat: "md",
      renderMode: "native",
    })).toEqual({
      text: "@Alice check",
      styles: [{ start: 0, len: 12, st: TextStyle.Bold }],
      mentions: [{ uid: "u1", pos: 0, len: 6 }],
    });
  });

  test("zalo native markdown remaps styles after adjacent mention placeholders", () => {
    expect(renderZaloPersonalMessage({
      text: "<@u1|Alice>**check**",
      inputFormat: "md",
      renderMode: "native",
    })).toEqual({
      text: "@Alicecheck",
      styles: [{ start: 6, len: 5, st: TextStyle.Bold }],
      mentions: [{ uid: "u1", pos: 0, len: 6 }],
    });
  });

  test("zalo native markdown treats an unclosed fenced block as literal text", () => {
    expect(renderZaloPersonalMessage({
      text: "```ts\n**not style**",
      inputFormat: "md",
      renderMode: "native",
    })).toEqual({
      text: "```ts\n**not style**",
    });
  });

  test("friend invite list treats Zalo code 112 as an empty sent list", async () => {
    const api = createFullApi();
    api.getSentFriendRequest = async () => {
      throw Object.assign(new Error("Lỗi không xác định"), { code: 112 });
    };
    const { deps, output } = createDeps(api);

    await runContactsCli([
      "friend-invites",
      "list",
      "--channel",
      "zalo-personal",
      "--direction",
      "all",
      "--json",
    ], deps as any);

    expect(JSON.parse(output.at(-1)!)).toEqual({
      sent: {},
      incoming: [{ dataInfo: { recommType: 2 } }],
    });
  });

  test("label all matching requires every requested label to be present", async () => {
    const { deps, output } = createDeps({
      getAllFriends: async () => [{ userId: "u1", displayName: "Alice" }],
      getLabels: async () => ({
        labelData: [{ id: 7, text: "vip", textKey: "vip", conversations: ["u1"] }],
      }),
    });

    await runContactsCli([
      "list",
      "--channel",
      "zalo-personal",
      "--label",
      "vip",
      "--label",
      "missing",
      "--label-match",
      "all",
    ], deps as any);

    expect(output.join("\n")).not.toContain("u1");
  });

  test("contacts list filters by favorite and label and prints route-ready ids", async () => {
    const { deps, output } = createDeps({
      getAllFriends: async () => [
        { userId: "u1", displayName: "Alice" },
        { userId: "u2", displayName: "Bob" },
      ],
      getCloseFriends: async () => [{ userId: "u1" }],
      getLabels: async () => ({
        labelData: [{ id: 7, text: "vip", textKey: "vip", conversations: ["u1"] }],
      }),
    });

    await runContactsCli([
      "list",
      "--channel",
      "zalo-personal",
      "--favorite",
      "--label",
      "vip",
    ], deps as any);

    expect(output.join("\n")).toContain("u1\tAlice");
    expect(output.join("\n")).toContain("clisbot routes add --channel zalo-personal dm:u1 --bot default");
    expect(output.join("\n")).not.toContain("u2");
  });

  test("groups list prints raw group ids and route examples", async () => {
    const { deps, output } = createDeps({
      getAllGroups: async () => ({ gridVerMap: { g1: "1" } }),
      getGroupInfo: async () => ({
        gridInfoMap: { g1: { name: "Team", totalMember: 3 } },
      }),
    });

    await runGroupsCli(["list", "--channel", "zalo-personal"], deps as any);

    expect(output.join("\n")).toContain("g1\tTeam\tmembers=3");
    expect(output.join("\n")).toContain("group:g1 --bot default");
  });

  test("mutating contact commands require confirmation", async () => {
    const { deps } = createDeps({ blockUser: async () => "" });
    await expect(runContactsCli([
      "blocked",
      "add",
      "--channel",
      "zalo-personal",
      "--user",
      "u1",
    ], deps as any)).rejects.toThrow("requires --confirm");
  });

  test("channel-native enhanced send derives mentions and styles", async () => {
    const calls: any[] = [];
    const { deps } = createDeps({
      sendMessage: async (...args: any[]) => {
        calls.push(args);
        return { message: { msgId: 1 }, attachment: [] };
      },
    });

    await runChannelNativeCli([
      "--channel",
      "zalo-personal",
      "messages",
      "send",
      "--target",
      "group:g1",
      "--message",
      "<@u1|Alice> **check**",
      "--style",
      "red:0:6",
    ], deps as any);

    expect(calls[0][0]).toMatchObject({
      msg: "@Alice check",
      mentions: [{ uid: "u1", pos: 0, len: 6 }],
    });
    expect(calls[0][1]).toBe("g1");
    expect(calls[0][2]).toBe(1);
  });

  test("phase 1 discovery commands smoke through the zca-js API boundary", async () => {
    const api = createFullApi();
    const { deps } = createDeps(api);
    const base = ["--channel", "zalo-personal"];

    await runContactsCli(["search", ...base, "ali"], deps as any);
    await runContactsCli(["get", ...base, "u1", "--business"], deps as any);
    await runContactsCli(["recommendations", "list", ...base], deps as any);
    await runContactsCli(["aliases", "list", ...base], deps as any);
    await runContactsCli(["labels", "list", ...base], deps as any);
    await runContactsCli(["boards", "list", ...base, "u1"], deps as any);
    await runContactsCli(["mutual-groups", "list", ...base, "u1"], deps as any);
    await runContactsCli(["friend-invites", "list", ...base, "--direction", "all"], deps as any);
    await runContactsCli(["friend-invites", "status", ...base, "u1"], deps as any);
    await runGroupsCli(["search", ...base, "team"], deps as any);
    await runGroupsCli(["get", ...base, "g1"], deps as any);
    await runGroupsCli(["members", "list", ...base, "g1"], deps as any);
    await runGroupsCli(["boards", "list", ...base, "g1"], deps as any);
    await runGroupsCli(["group-invites", "list", ...base], deps as any);
    await runGroupsCli(["group-invites", "get", ...base, "g1"], deps as any);

    expect(api.calls.length).toBeGreaterThan(10);
  });

  test("phase 2 mutations require confirm and call normalized zca-js APIs", async () => {
    const api = createFullApi();
    const { deps } = createDeps(api);
    const base = ["--channel", "zalo-personal", "--confirm"];

    await runContactsCli(["friend-invites", "send", ...base, "--user", "u1"], deps as any);
    await runContactsCli(["friend-invites", "accept", ...base, "u1"], deps as any);
    await runContactsCli(["friend-invites", "reject", ...base, "u1"], deps as any);
    await runContactsCli(["friend-invites", "cancel", ...base, "u1"], deps as any);
    await runContactsCli(["aliases", "set", ...base, "u1", "--alias", "A"], deps as any);
    await runContactsCli(["aliases", "clear", ...base, "u1"], deps as any);
    await runContactsCli(["labels", "add", ...base, "--name", "vip"], deps as any);
    await runContactsCli(["blocked", "add", ...base, "--user", "u1"], deps as any);
    await runContactsCli(["feed-blocked", "remove", ...base, "--user", "u1"], deps as any);
    await runContactsCli(["remove", ...base, "u1"], deps as any);
    await runGroupsCli(["add", ...base, "--name", "G", "--user", "u1"], deps as any);
    await runGroupsCli(["update", ...base, "g1", "--name", "New"], deps as any);
    await runGroupsCli(["avatar", "set", ...base, "g1", "--file", "avatar.png"], deps as any);
    await runGroupsCli(["members", "add", ...base, "g1", "--user", "u1"], deps as any);
    await runGroupsCli(["pending", "approve", ...base, "g1", "--user", "u1"], deps as any);
    await runGroupsCli(["blocked", "remove", ...base, "g1", "--user", "u1"], deps as any);
    await runGroupsCli(["invite-link", "enable", ...base, "g1"], deps as any);
    await runGroupsCli(["join", ...base, "https://zalo.me/g/x"], deps as any);
    await runGroupsCli(["group-invites", "send", ...base, "--group", "g1", "--phone", "849"], deps as any);
    await runGroupsCli(["group-invites", "accept", ...base, "g1"], deps as any);
    await runGroupsCli(["group-invites", "reject", ...base, "g1"], deps as any);
    await expect(runGroupsCli(["group-invites", "cancel", ...base, "--group", "g1", "--user", "u1"], deps as any))
      .rejects.toThrow("does not expose");

    expect(api.calls.map((call: any[]) => call[0])).toContain("sendFriendRequest");
    expect(api.calls.map((call: any[]) => call[0])).toContain("inviteUserToGroups");
  });

  test("phase 3 channel-native message commands smoke through zca-js APIs", async () => {
    const api = createFullApi();
    const { deps } = createDeps(api);
    const base = ["--channel", "zalo-personal", "messages"];

    await runChannelNativeCli([...base, "link", "send", "--target", "group:g1", "https://example.com"], deps as any);
    await runChannelNativeCli([...base, "parse-link", "https://example.com"], deps as any);
    await runChannelNativeCli([...base, "upload", "--target", "group:g1", "--file", "a.txt"], deps as any);
    await runChannelNativeCli([...base, "contact-card", "send", "--target", "dm:u1", "--user", "u2"], deps as any);
    await runChannelNativeCli([...base, "bank-card", "send", "--target", "dm:u1", "--bin-bank", "970436", "--account-number", "123"], deps as any);
    await runChannelNativeCli([...base, "typing", "--target", "group:g1"], deps as any);
    await runChannelNativeCli([...base, "delivered", "--target", "group:g1", "--message-id", "m:c:u"], deps as any);
    await runChannelNativeCli([...base, "seen", "--target", "group:g1", "--message-id", "m:c:u"], deps as any);
    await runChannelNativeCli([...base, "undo", "--target", "group:g1", "--message-id", "m:c", "--confirm"], deps as any);
    await runChannelNativeCli([...base, "forward", "--to", "dm:u1", "--message", "forwarded text", "--confirm"], deps as any);
    await runChannelNativeCli([...base, "polls", "add", "--target", "group:g1", "--question", "Q", "--option", "A"], deps as any);
    await runChannelNativeCli([...base, "polls", "vote", "--target", "group:g1", "--poll-id", "1", "--option", "2"], deps as any);
    await runChannelNativeCli([...base, "polls", "lock", "--target", "group:g1", "--poll-id", "1", "--confirm"], deps as any);
    await runChannelNativeCli([...base, "polls", "get", "--target", "group:g1", "--poll-id", "1"], deps as any);
    await runChannelNativeCli([...base, "polls", "options", "add", "--target", "group:g1", "--poll-id", "1", "--option", "B", "--confirm"], deps as any);
    await runChannelNativeCli([...base, "polls", "share", "--poll-id", "1", "--confirm"], deps as any);
    await runChannelNativeCli([...base, "report", "--target", "group:g1", "--reason", "fraud", "--confirm"], deps as any);

    expect(api.calls.map((call: any[]) => call[0])).toContain("createPoll");
    expect(api.calls.map((call: any[]) => call[0])).toContain("sendReport");
  });
});

function createFullApi() {
  const calls: any[] = [];
  const record = (name: string, value: unknown = "") => async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return value;
  };
  return {
    calls,
    getAllFriends: record("getAllFriends", [{ userId: "u1", displayName: "Alice" }]),
    getCloseFriends: record("getCloseFriends", [{ userId: "u1" }]),
    getLabels: record("getLabels", { version: 1, labelData: [{ id: 1, text: "vip", conversations: ["u1"] }] }),
    getMultiUsersByPhones: record("getMultiUsersByPhones", { "849": { userId: "u9", displayName: "Phone" } }),
    findUserByUsername: record("findUserByUsername", { userId: "ux", displayName: "User X" }),
    getUserInfo: record("getUserInfo", { changed_profiles: { u1: { userId: "u1" } } }),
    getBizAccount: record("getBizAccount", { biz: null }),
    getFriendRecommendations: record("getFriendRecommendations", { recommItems: [{ dataInfo: { recommType: 2 } }] }),
    getAliasList: record("getAliasList", { items: [] }),
    getFriendBoardList: record("getFriendBoardList", { data: [], version: 1 }),
    getRelatedFriendGroup: record("getRelatedFriendGroup", { groupRelateds: { u1: ["g1"] } }),
    getSentFriendRequest: record("getSentFriendRequest", {}),
    getFriendRequestStatus: record("getFriendRequestStatus", { is_friend: 0 }),
    sendFriendRequest: record("sendFriendRequest"),
    acceptFriendRequest: record("acceptFriendRequest"),
    rejectFriendRequest: record("rejectFriendRequest"),
    undoFriendRequest: record("undoFriendRequest"),
    changeFriendAlias: record("changeFriendAlias"),
    removeFriendAlias: record("removeFriendAlias"),
    updateLabels: record("updateLabels", { version: 2, labelData: [] }),
    blockUser: record("blockUser"),
    unblockUser: record("unblockUser"),
    blockViewFeed: record("blockViewFeed"),
    removeFriend: record("removeFriend"),
    getAllGroups: record("getAllGroups", { gridVerMap: { g1: "1" } }),
    getGroupInfo: record("getGroupInfo", { gridInfoMap: { g1: { name: "Team", memberIds: ["u1"], totalMember: 1 } } }),
    getGroupMembersInfo: record("getGroupMembersInfo", { profiles: { u1: { id: "u1", displayName: "Alice" } } }),
    getListBoard: record("getListBoard", { items: [], count: 0 }),
    getGroupInviteBoxList: record("getGroupInviteBoxList", { invitations: [] }),
    getGroupInviteBoxInfo: record("getGroupInviteBoxInfo", { groupInfo: { groupId: "g1" } }),
    createGroup: record("createGroup", { groupId: "g2" }),
    changeGroupName: record("changeGroupName", { status: 0 }),
    changeGroupAvatar: record("changeGroupAvatar"),
    addUserToGroup: record("addUserToGroup", { errorMembers: [] }),
    removeUserFromGroup: record("removeUserFromGroup", { errorMembers: [] }),
    getPendingGroupMembers: record("getPendingGroupMembers", { users: [] }),
    reviewPendingMemberRequest: record("reviewPendingMemberRequest", { u1: 0 }),
    getGroupBlockedMember: record("getGroupBlockedMember", { blocked_members: [] }),
    addGroupBlockedMember: record("addGroupBlockedMember"),
    removeGroupBlockedMember: record("removeGroupBlockedMember"),
    getGroupLinkDetail: record("getGroupLinkDetail", { enabled: 1 }),
    enableGroupLink: record("enableGroupLink", { link: "https://zalo.me/g/x" }),
    disableGroupLink: record("disableGroupLink"),
    joinGroupLink: record("joinGroupLink"),
    inviteUserToGroups: record("inviteUserToGroups", { grid_message_map: {} }),
    joinGroupInviteBox: record("joinGroupInviteBox"),
    deleteGroupInviteBox: record("deleteGroupInviteBox", { delInvitaionIds: ["g1"], errMap: {} }),
    sendMessage: record("sendMessage", { message: { msgId: 1 }, attachment: [] }),
    sendLink: record("sendLink", { msgId: "1" }),
    parseLink: record("parseLink", { data: { href: "https://example.com" }, error_maps: {} }),
    uploadAttachment: record("uploadAttachment", [{ fileUrl: "https://file" }]),
    sendCard: record("sendCard", { msgId: 1 }),
    sendBankCard: record("sendBankCard"),
    sendTypingEvent: record("sendTypingEvent"),
    sendDeliveredEvent: record("sendDeliveredEvent"),
    sendSeenEvent: record("sendSeenEvent", { status: 0 }),
    undo: record("undo", { status: 0 }),
    forwardMessage: record("forwardMessage", { success: [], fail: [] }),
    createPoll: record("createPoll", { id: 1 }),
    votePoll: record("votePoll", { options: [] }),
    lockPoll: record("lockPoll"),
    getPollDetail: record("getPollDetail", { id: 1 }),
    addPollOptions: record("addPollOptions", { options: [] }),
    sharePoll: record("sharePoll"),
    sendReport: record("sendReport", { reportId: "r1" }),
  };
}
