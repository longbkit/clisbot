// The inbound normalizer (D-ZU-013): the shared `ChannelInboundEvent` a
// `zca-js` message becomes, including the `kind` + `facts` the Hub routes on.

import { describe, expect, it } from "vitest";
import type { ZaloInboundMessage } from "../types.js";
import { buildZalouserInboundEvent, wasZalouserAddressed } from "./inbound-adapter.js";

function message(overrides: Partial<ZaloInboundMessage> = {}): ZaloInboundMessage {
  return {
    threadId: "111",
    isGroup: false,
    senderId: "222",
    senderName: "Alice",
    content: "hello",
    commandContent: "hello",
    timestampMs: 1_757_203_200_000,
    msgId: "msg-1",
    cliMsgId: "cli-1",
    raw: {},
    ...overrides,
  };
}

describe("buildZalouserInboundEvent", () => {
  it("maps a DM onto a message event addressed at the account", () => {
    const build = buildZalouserInboundEvent(message(), { accountId: "acct" });
    expect(build.admit).toBe(true);
    if (!build.admit) return;
    expect(build.event).toMatchObject({
      channel: "zalouser",
      externalEventId: "msg-1:cli-1",
      externalMessageId: "msg-1:cli-1",
      externalConversationId: "111",
      chatType: "direct",
      senderId: "222",
      senderName: "Alice",
      body: "hello",
      wasMentioned: true,
      replyTo: "user:111",
      kind: "message",
    });
  });

  it("carries the msgId:cliMsgId pair so an inbound message stays reactable", () => {
    const build = buildZalouserInboundEvent(message({ msgId: "m", cliMsgId: "c" }), {
      accountId: "acct",
    });
    expect(build.admit && build.event.externalMessageId).toBe("m:c");
  });

  it("labels a group and only marks it addressed on an explicit mention", () => {
    const plain = buildZalouserInboundEvent(
      message({ isGroup: true, threadId: "g1", groupName: "Team" }),
      { accountId: "acct" },
    );
    expect(plain.admit && plain.event).toMatchObject({
      chatType: "group",
      conversationLabel: "Team",
      replyTo: "group:g1",
      wasMentioned: false,
    });

    const mentioned = buildZalouserInboundEvent(
      message({
        isGroup: true,
        threadId: "g1",
        wasExplicitlyMentioned: true,
        canResolveExplicitMention: true,
        hasAnyMention: true,
      }),
      { accountId: "acct" },
    );
    expect(mentioned.admit && mentioned.event.wasMentioned).toBe(true);
  });

  it("treats a quote of the account's own message as addressed", () => {
    const build = buildZalouserInboundEvent(
      message({ isGroup: true, implicitMention: true }),
      { accountId: "acct" },
    );
    expect(build.admit && build.event.wasMentioned).toBe(true);
  });

  it("treats an unattributable mention as addressed", () => {
    expect(
      wasZalouserAddressed(
        message({ isGroup: true, hasAnyMention: true, canResolveExplicitMention: false }),
      ),
    ).toBe(true);
    expect(
      wasZalouserAddressed(
        message({ isGroup: true, hasAnyMention: true, canResolveExplicitMention: true }),
      ),
    ).toBe(false);
  });

  it("reads a leading /verb in the mention-stripped body as a command", () => {
    const build = buildZalouserInboundEvent(
      message({ content: "@bot /status now", commandContent: "/status now" }),
      { accountId: "acct" },
    );
    expect(build.admit && build.event).toMatchObject({
      kind: "command",
      body: "/status now",
      facts: { command: { name: "status", args: "now" } },
    });
  });

  it("skips the account's own message, an empty body and a message without ids", () => {
    expect(
      buildZalouserInboundEvent(message({ senderId: "999" }), {
        accountId: "acct",
        ownUserId: "999",
      }),
    ).toEqual({ admit: false, reason: "own-message" });
    expect(
      buildZalouserInboundEvent(message({ content: "  ", commandContent: "  " }), {
        accountId: "acct",
      }),
    ).toEqual({ admit: false, reason: "empty-body" });
    expect(
      buildZalouserInboundEvent(message({ msgId: undefined, cliMsgId: undefined }), {
        accountId: "acct",
      }),
    ).toEqual({ admit: false, reason: "no-message-id" });
  });
});
