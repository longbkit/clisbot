import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ChannelInboundEvent } from "@getpaseo/channels-shared";
import { SlackSenderDirectory, slackPersonName, type SlackUsersClient } from "./sender-directory.js";

const PEOPLE: Record<string, unknown> = {
  U018WR2K090: { user: { name: "minh.duong", real_name: "Minh", profile: { real_name: "Minh Dương" } } },
  U02ABC: { user: { name: "lan", profile: { display_name: "Lan Nguyễn" } } },
};

function directoryClient(overrides: { fail?: unknown } = {}) {
  const calls: string[] = [];
  const client: SlackUsersClient = {
    users: {
      info: async ({ user }) => {
        calls.push(user);
        if (overrides.fail !== undefined) throw overrides.fail;
        return PEOPLE[user] ?? { user: {} };
      },
    },
  };
  return { client, calls };
}

const event = (body: string): ChannelInboundEvent => ({
  channel: "slack",
  externalEventId: "1.2",
  externalMessageId: "1.2",
  externalConversationId: "C0ROOM",
  chatType: "channel",
  senderId: "U018WR2K090",
  body,
  wasMentioned: true,
  timestampMs: 0,
});

describe("slackPersonName", () => {
  it("prefers the profile's real name, then display name, and keeps the handle", () => {
    assert.deepEqual(slackPersonName(PEOPLE["U018WR2K090"]), { name: "Minh Dương", handle: "minh.duong" });
    assert.deepEqual(slackPersonName(PEOPLE["U02ABC"]), { name: "Lan Nguyễn", handle: "lan" });
    assert.deepEqual(slackPersonName({ user: {} }), {});
  });
});

describe("SlackSenderDirectory", () => {
  it("names the sender and the people the body mentions, asking Slack once per person", async () => {
    const { client, calls } = directoryClient();
    const directory = new SlackSenderDirectory();
    const named = await directory.name(client, event("ask <@U02ABC> and <@U0NOBODY>"));
    assert.equal(named.senderName, "Minh Dương");
    assert.equal(named.senderUsername, "minh.duong");
    assert.equal(named.body, "ask @Lan Nguyễn and <@U0NOBODY>");
    await directory.name(client, event("again <@U02ABC>"));
    assert.deepEqual(calls.toSorted(), ["U018WR2K090", "U02ABC", "U0NOBODY"], "cache hits");
  });

  it("falls back to the id when Slack fails, and retries only after a while", async () => {
    let now = 0;
    const { client, calls } = directoryClient({ fail: new Error("network down") });
    const directory = new SlackSenderDirectory({ now: () => now, failureTtlMs: 1_000 });
    const named = await directory.name(client, event("hi"));
    assert.equal(named.senderName, undefined);
    await directory.lookup(client, "U018WR2K090");
    assert.equal(calls.length, 1);
    now = 2_000;
    await directory.lookup(client, "U018WR2K090");
    assert.equal(calls.length, 2);
  });

  it("stops asking, and says so once, when the token lacks users:read", async () => {
    const warnings: string[] = [];
    const { client, calls } = directoryClient({ fail: { error: "missing_scope" } });
    const directory = new SlackSenderDirectory({
      logger: { warn: (message: string) => warnings.push(message) } as never,
    });
    await directory.lookup(client, "U018WR2K090");
    await directory.lookup(client, "U02ABC");
    assert.equal(calls.length, 1);
    assert.equal(warnings.length, 1);
  });

  it("gives up on a slow lookup instead of holding admission", async () => {
    const client: SlackUsersClient = { users: { info: () => new Promise(() => undefined) } };
    const directory = new SlackSenderDirectory({ timeoutMs: 10 });
    assert.deepEqual(await directory.lookup(client, "U018WR2K090"), {});
  });
});
