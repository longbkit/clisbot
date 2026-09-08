import { describe, expect, it } from "vitest";
import { channelPairingResource } from "./channel-api";
import {
  channelPairingRows,
  channelPairingSummary,
  pendingChannelPairings,
} from "./channel-pairing";
import { HubChannelPairingsSchema } from "./contracts";

/** The body `GET channel-accounts/telegram/support/pairing` answers with. */
const response = {
  pairings: [
    {
      channel: "telegram",
      accountId: "support",
      senderIdentity: "telegram:77002",
      senderName: null,
      code: "ZZZ111",
      status: "denied",
      externalConversationId: "77002",
      decidedAt: "2026-09-06T10:00:00.000Z",
      createdAt: "2026-09-06T09:00:00.000Z",
    },
    {
      channel: "telegram",
      accountId: "support",
      senderIdentity: "telegram:77001",
      senderName: "Stranger",
      code: "ABC234",
      status: "pending",
      externalConversationId: "77001",
      decidedAt: null,
      createdAt: "2026-09-05T09:00:00.000Z",
    },
    {
      channel: "telegram",
      accountId: "support",
      senderIdentity: "telegram:77003",
      senderName: "Newcomer",
      code: "QQQ777",
      status: "pending",
      externalConversationId: "77003",
      decidedAt: null,
      createdAt: "2026-09-07T09:00:00.000Z",
    },
  ],
};

describe("pairing contract", () => {
  it("parses the Hub's queue", () => {
    const parsed = HubChannelPairingsSchema.parse(response);
    expect(parsed.pairings).toHaveLength(3);
    expect(parsed.pairings[0]?.senderName).toBeNull();
  });

  it("rejects a decision status it has no rendering for", () => {
    expect(() =>
      HubChannelPairingsSchema.parse({
        pairings: [{ ...response.pairings[1], status: "expired" }],
      }),
    ).toThrow();
  });

  it("addresses the queue and both decisions under the account", () => {
    expect(channelPairingResource("telegram", "support")).toBe(
      "channel-accounts/telegram/support/pairing",
    );
    expect(channelPairingResource("telegram", "support", "approve")).toBe(
      "channel-accounts/telegram/support/pairing/approve",
    );
    expect(channelPairingResource("zalo user", "a/b", "deny")).toBe(
      "channel-accounts/zalo%20user/a%2Fb/pairing/deny",
    );
  });
});

describe("pairing queue", () => {
  const rows = channelPairingRows(HubChannelPairingsSchema.parse(response).pairings);

  it("puts the waiting senders first, newest request first", () => {
    expect(rows.map((row) => row.senderIdentity)).toEqual([
      "telegram:77003",
      "telegram:77001",
      "telegram:77002",
    ]);
  });

  it("leads with the code the sender is looking at", () => {
    expect(rows[1]).toMatchObject({
      title: "Stranger",
      detail: "Code ABC234 · telegram:77001 · in 77001",
      statusLabel: "Waiting",
      decidable: true,
    });
  });

  it("names an anonymous sender by its identity", () => {
    expect(rows[2]?.title).toBe("telegram:77002");
  });

  it("offers no action on a decision, because a decision is final", () => {
    expect(rows[2]).toMatchObject({ status: "denied", statusLabel: "Denied", decidable: false });
    expect(pendingChannelPairings(rows).map((row) => row.senderIdentity)).toEqual([
      "telegram:77003",
      "telegram:77001",
    ]);
  });

  it("summarizes what the operator has to do", () => {
    expect(channelPairingSummary(rows)).toBe("2 people are waiting for a decision.");
    expect(channelPairingSummary(rows.slice(0, 1))).toBe("1 person is waiting for a decision.");
    expect(channelPairingSummary(rows.slice(2))).toBe("Every pairing request has been decided.");
    expect(channelPairingSummary([])).toBe("No one has asked to use this account.");
  });
});
