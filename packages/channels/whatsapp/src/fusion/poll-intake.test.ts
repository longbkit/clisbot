import { createHash, randomBytes } from "node:crypto";
import { aesEncryptGCM, hmacSign, proto, type WAMessage } from "baileys";
import { describe, expect, it, vi } from "vitest";
import { rememberWhatsAppBaileysCacheEntry } from "../inbound/baileys-cache.js";
import { createWhatsAppPollIntake } from "./poll-intake.js";
import { createRecordingHostRuntime } from "./test-support.js";
import { openWhatsAppPollStore } from "./polls.js";

const SELF = "15550001111@s.whatsapp.net";
const DM = "15557778888@s.whatsapp.net";

function encryptVote(secret: Buffer, pollId: string, creatorJid: string, voterJid: string, names: string[]) {
  const sign = Buffer.concat([Buffer.from(pollId), Buffer.from(creatorJid), Buffer.from(voterJid), Buffer.from("Poll Vote"), new Uint8Array([1])]);
  const key = hmacSign(sign, hmacSign(secret, new Uint8Array(32), "sha256"), "sha256");
  const iv = randomBytes(12);
  const payload = proto.Message.PollVoteMessage.encode({ selectedOptions: names.map((n) => createHash("sha256").update(n).digest()) }).finish();
  return { encPayload: aesEncryptGCM(payload, key, iv, Buffer.from(`${pollId}\u0000${voterJid}`)), encIv: iv };
}

describe("poll intake", () => {
  it("stores a poll the account sent and turns a DM vote into a recorded poll_answer", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    const admitted: unknown[] = [];
    const intake = createWhatsAppPollIntake({
      accountId: "a",
      polls: openWhatsAppPollStore(hostRuntime),
      selfJids: () => [SELF],
      resolveVoterId: async () => "+15557778888",
      admit: async (event) => {
        admitted.push(event);
        return true;
      },
    });
    const secret = randomBytes(32);
    const cache = new Map();
    rememberWhatsAppBaileysCacheEntry(cache, `${DM}:P1`, {
      messageContextInfo: { messageSecret: secret },
      pollCreationMessage: { name: "Ship it?", options: [{ optionName: "Yes" }, { optionName: "No" }] },
    }, 60_000);
    await intake.rememberSent({ kind: "poll", messageId: "P1", keys: [{ id: "P1", remoteJid: DM }], providerAccepted: true } as never, cache);

    const vote = {
      key: { id: "V1", remoteJid: DM, fromMe: false },
      pushName: "Bob",
      message: { pollUpdateMessage: { pollCreationMessageKey: { id: "P1", remoteJid: DM, fromMe: true }, vote: encryptVote(secret, "P1", SELF, DM, ["No"]) } },
    } as WAMessage;
    expect(await intake.handleVote(vote)).toBe(true);
    expect(admitted).toEqual([
      expect.objectContaining({
        kind: "poll_answer",
        externalConversationId: DM,
        senderId: "+15557778888",
        body: "[Poll answer] Ship it?: No",
        facts: { pollAnswer: { pollId: "P1", optionIds: [1], voterId: "+15557778888" } },
      }),
    ]);
  });

  it("swallows a vote for a poll it never saw, and leaves other messages alone", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    const warn = vi.fn();
    const intake = createWhatsAppPollIntake({
      accountId: "a",
      polls: openWhatsAppPollStore(hostRuntime),
      selfJids: () => [SELF],
      resolveVoterId: async () => null,
      admit: async () => true,
      logger: { warn },
    });
    const vote = { key: { id: "V", remoteJid: DM }, message: { pollUpdateMessage: { pollCreationMessageKey: { id: "UNKNOWN" }, vote: { encPayload: Buffer.alloc(16), encIv: Buffer.alloc(12) } } } } as WAMessage;
    expect(await intake.handleVote(vote)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unknown poll/));
    expect(await intake.handleVote({ key: { id: "T", remoteJid: DM }, message: { conversation: "hi" } } as WAMessage)).toBe(false);
  });
});
