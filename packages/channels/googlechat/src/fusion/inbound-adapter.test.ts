// The normalizer between a Google Chat envelope and the shared inbound event.
import { describe, expect, it } from "vitest";
import { buildGoogleChatInboundEvent, extractMentionInfo } from "./inbound-adapter.js";
import type { GoogleChatEvent } from "../types.js";

const SPACE = "spaces/AAAA";

function message(overrides: Partial<GoogleChatEvent> = {}): GoogleChatEvent {
  return {
    type: "MESSAGE",
    eventTime: "2026-09-07T01:02:03Z",
    space: { name: SPACE, spaceType: "SPACE", displayName: "Ops" },
    message: {
      name: `${SPACE}/messages/M1`,
      text: "@app deploy please",
      argumentText: "deploy please",
      sender: { name: "users/111", displayName: "Ada", email: "ada@example.com", type: "HUMAN" },
      thread: { name: `${SPACE}/threads/T1` },
      annotations: [{ type: "USER_MENTION", userMention: { user: { name: "users/app" } } }],
    },
    ...overrides,
  };
}

describe("buildGoogleChatInboundEvent", () => {
  it("normalizes a mention-addressed space message", () => {
    const build = buildGoogleChatInboundEvent(message(), { accountId: "default" });
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event).toMatchObject({
      channel: "googlechat",
      externalMessageId: `${SPACE}/messages/M1`,
      externalConversationId: SPACE,
      chatType: "channel",
      messageThreadId: `${SPACE}/threads/T1`,
      senderId: "users/111",
      senderName: "Ada",
      senderUsername: "ada@example.com",
      // `argumentText` already has the mention removed; carrying `text` would
      // hand the agent the mention twice.
      body: "deploy please",
      wasMentioned: true,
      conversationLabel: "Ops",
      kind: "message",
    });
    expect(build.event.timestampMs).toBe(Date.parse("2026-09-07T01:02:03Z"));
  });

  it("marks a DM space as a direct chat with no thread", () => {
    const build = buildGoogleChatInboundEvent(
      message({
        space: { name: SPACE, spaceType: "DIRECT_MESSAGE", singleUserBotDm: true },
      }),
      { accountId: "default" },
    );
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event.chatType).toBe("direct");
    expect(build.event.messageThreadId).toBeUndefined();
  });

  it("reports no mention when the annotation names another user", () => {
    const build = buildGoogleChatInboundEvent(
      message({
        message: {
          ...message().message,
          annotations: [{ type: "USER_MENTION", userMention: { user: { name: "users/999" } } }],
        },
      }),
      { accountId: "default" },
    );
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event.wasMentioned).toBe(false);
  });

  it("matches the configured bot user as a mention", () => {
    const build = buildGoogleChatInboundEvent(
      message({
        message: {
          ...message().message,
          annotations: [{ type: "USER_MENTION", userMention: { user: { name: "users/12345" } } }],
        },
      }),
      { accountId: "default", botUser: "users/12345" },
    );
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event.wasMentioned).toBe(true);
  });

  it("refuses the app's own message and any bot author without allowBots", () => {
    const own = buildGoogleChatInboundEvent(
      message({
        message: { ...message().message, sender: { name: "users/app", type: "BOT" } },
      }),
      { accountId: "default" },
    );
    expect(own).toEqual({ admit: false, reason: "bot-message" });

    const otherBot = buildGoogleChatInboundEvent(
      message({
        message: { ...message().message, sender: { name: "users/222", type: "BOT" } },
      }),
      { accountId: "default" },
    );
    expect(otherBot).toEqual({ admit: false, reason: "bot-message" });

    const allowed = buildGoogleChatInboundEvent(
      message({
        message: { ...message().message, sender: { name: "users/222", type: "BOT" } },
      }),
      { accountId: "default", allowBots: true },
    );
    expect(allowed.admit).toBe(true);
  });

  it("still refuses the configured bot user's own message under allowBots", () => {
    const build = buildGoogleChatInboundEvent(
      message({
        message: { ...message().message, sender: { name: "users/12345", type: "BOT" } },
      }),
      { accountId: "default", allowBots: true, botUser: "users/12345" },
    );
    expect(build).toEqual({ admit: false, reason: "own-message" });
  });

  it("refuses an empty body", () => {
    const build = buildGoogleChatInboundEvent(
      message({ message: { ...message().message, text: "", argumentText: "   " } }),
      { accountId: "default" },
    );
    expect(build).toEqual({ admit: false, reason: "empty-body" });
  });

  it("classifies a leading slash line as a command with its facts", () => {
    const build = buildGoogleChatInboundEvent(
      message({ message: { ...message().message, argumentText: "/status  deploy prod" } }),
      { accountId: "default" },
    );
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event.kind).toBe("command");
    expect(build.event.facts?.command).toEqual({ name: "status", args: "deploy prod" });
  });

  it("normalizes a card click into a callback with the clicking user's id", () => {
    const build = buildGoogleChatInboundEvent(
      {
        type: "CARD_CLICKED",
        eventTime: "2026-09-07T01:02:03Z",
        space: { name: SPACE, spaceType: "SPACE" },
        user: { name: "users/777", displayName: "Grace" },
        action: { actionMethodName: "approve", parameters: [{ key: "id", value: "req-42" }] },
        message: { name: `${SPACE}/messages/CARD` },
      },
      { accountId: "default" },
    );
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event.kind).toBe("callback");
    expect(build.event.facts?.callback).toEqual({
      actionId: "approve",
      value: "req-42",
      actorId: "users/777",
      messageId: `${SPACE}/messages/CARD`,
    });
    // A click is addressed at the app that rendered the card, so the Hub's
    // mention policy must not filter it out in a space that requires mentions.
    expect(build.event.wasMentioned).toBe(true);
  });

  it("reads a Workspace add-on card click through commonEventObject", () => {
    const build = buildGoogleChatInboundEvent(
      {
        type: "CARD_CLICKED",
        eventTime: "2026-09-07T01:02:03Z",
        space: { name: SPACE, spaceType: "SPACE" },
        user: { name: "users/777" },
        commonEventObject: { invokedFunction: "deny", parameters: { token: "abc" } },
        message: { name: `${SPACE}/messages/CARD` },
      },
      { accountId: "default" },
    );
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event.facts?.callback).toMatchObject({ actionId: "deny", value: "abc" });
  });

  it("normalizes space membership events as member facts", () => {
    const added = buildGoogleChatInboundEvent(
      {
        type: "ADDED_TO_SPACE",
        eventTime: "2026-09-07T01:02:03Z",
        space: { name: SPACE, spaceType: "SPACE", displayName: "Ops" },
        user: { name: "users/777", displayName: "Grace" },
      },
      { accountId: "default" },
    );
    expect(added.admit).toBe(true);
    if (!added.admit) return;
    expect(added.event.kind).toBe("member");
    expect(added.event.facts?.member).toEqual({ userId: "users/777", joined: true });

    const removed = buildGoogleChatInboundEvent(
      {
        type: "REMOVED_FROM_SPACE",
        eventTime: "2026-09-07T01:02:03Z",
        space: { name: SPACE, spaceType: "SPACE" },
        user: { name: "users/777" },
      },
      { accountId: "default" },
    );
    expect(removed.admit).toBe(true);
    if (!removed.admit) return;
    expect(removed.event.facts?.member).toEqual({ userId: "users/777", joined: false });
  });

  it("refuses an event type the Hub has no policy for", () => {
    const build = buildGoogleChatInboundEvent(
      { type: "WIDGET_UPDATED", space: { name: SPACE } },
      { accountId: "default" },
    );
    expect(build).toEqual({ admit: false, reason: "not-a-turn-event" });
  });
});

describe("extractMentionInfo", () => {
  it("treats any users/app-normalizing id as the app itself", () => {
    expect(
      extractMentionInfo([
        { type: "USER_MENTION", userMention: { user: { name: "users/APP" } } },
      ]),
    ).toEqual({ hasAnyMention: true, wasMentioned: true });
  });

  it("ignores non-mention annotations", () => {
    expect(extractMentionInfo([{ type: "SLASH_COMMAND" }])).toEqual({
      hasAnyMention: false,
      wasMentioned: false,
    });
  });
});
