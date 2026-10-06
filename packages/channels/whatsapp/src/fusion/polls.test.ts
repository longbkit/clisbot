import { createHash, randomBytes } from "node:crypto";
import { aesEncryptGCM, hmacSign, proto, type WAMessage } from "baileys";
import { describe, expect, it } from "vitest";
import { decodePollVote, readPollCreation, readPollVote } from "./polls.js";

const SELF_PN = "15550001111@s.whatsapp.net";
const SELF_LID = "99900011122@lid";
const GROUP = "120363000000000001@g.us";
const VOTER_LID = "77788899900@lid";

/** The voter's client side of WhatsApp's poll vote encryption (the inverse of
 * Baileys' `decryptPollVote`). */
function encryptVote(params: {
  secret: Buffer;
  pollId: string;
  creatorJid: string;
  voterJid: string;
  optionNames: string[];
}): proto.Message.IPollEncValue {
  const sign = Buffer.concat([
    Buffer.from(params.pollId),
    Buffer.from(params.creatorJid),
    Buffer.from(params.voterJid),
    Buffer.from("Poll Vote"),
    new Uint8Array([1]),
  ]);
  const key0 = hmacSign(params.secret, new Uint8Array(32), "sha256");
  const encKey = hmacSign(sign, key0, "sha256");
  const iv = randomBytes(12);
  const plaintext = proto.Message.PollVoteMessage.encode({
    selectedOptions: params.optionNames.map((name) => createHash("sha256").update(name).digest()),
  }).finish();
  const encPayload = aesEncryptGCM(plaintext, encKey, iv, Buffer.from(`${params.pollId}\u0000${params.voterJid}`));
  return { encPayload, encIv: iv };
}

function ownPoll(secret: Buffer): WAMessage {
  return {
    key: { id: "POLL1", remoteJid: GROUP, fromMe: true },
    message: {
      messageContextInfo: { messageSecret: secret },
      pollCreationMessageV3: {
        name: "Lunch?",
        options: [{ optionName: "Pho" }, { optionName: "Bun cha" }, { optionName: "Com tam" }],
        selectableOptionsCount: 2,
      },
    },
  } as WAMessage;
}

function vote(enc: proto.Message.IPollEncValue, voter: { participant: string; participantAlt?: string }): WAMessage {
  return {
    key: { id: "VOTE1", remoteJid: GROUP, fromMe: false, ...voter },
    message: { pollUpdateMessage: { pollCreationMessageKey: { id: "POLL1", remoteJid: GROUP, fromMe: true }, vote: enc } },
  } as WAMessage;
}

describe("fusion polls (vote decryption)", () => {
  it("decodes a group vote whose AAD used the account's LID and the voter's LID", () => {
    const secret = randomBytes(32);
    const created = readPollCreation(ownPoll(secret), [SELF_PN, SELF_LID]);
    expect(created?.poll).toMatchObject({ question: "Lunch?", options: ["Pho", "Bun cha", "Com tam"], chatJid: GROUP });
    const enc = encryptVote({ secret, pollId: "POLL1", creatorJid: SELF_LID, voterJid: VOTER_LID, optionNames: ["Bun cha", "Com tam"] });
    const read = readPollVote(vote(enc, { participant: "15557778888@s.whatsapp.net", participantAlt: VOTER_LID }));
    expect(read?.pollId).toBe("POLL1");
    const decoded = decodePollVote({ pollId: "POLL1", poll: created!.poll, voterJids: read!.voterJids, vote: read!.vote });
    expect(decoded).toEqual({ pollId: "POLL1", chatJid: GROUP, question: "Lunch?", optionIds: [1, 2], optionNames: ["Bun cha", "Com tam"] });
  });

  it("decodes a retracted vote as no options", () => {
    const secret = randomBytes(32);
    const created = readPollCreation(ownPoll(secret), [SELF_PN]);
    const enc = encryptVote({ secret, pollId: "POLL1", creatorJid: SELF_PN, voterJid: "15557778888@s.whatsapp.net", optionNames: [] });
    const read = readPollVote(vote(enc, { participant: "15557778888@s.whatsapp.net" }))!;
    expect(decodePollVote({ pollId: "POLL1", poll: created!.poll, voterJids: read.voterJids, vote: read.vote })?.optionIds).toEqual([]);
  });

  it("refuses a vote encrypted with another poll's secret", () => {
    const created = readPollCreation(ownPoll(randomBytes(32)), [SELF_PN]);
    const enc = encryptVote({ secret: randomBytes(32), pollId: "POLL1", creatorJid: SELF_PN, voterJid: "15557778888@s.whatsapp.net", optionNames: ["Pho"] });
    const read = readPollVote(vote(enc, { participant: "15557778888@s.whatsapp.net" }))!;
    expect(decodePollVote({ pollId: "POLL1", poll: created!.poll, voterJids: read.voterJids, vote: read.vote })).toBeUndefined();
  });

  it("ignores messages that are not polls or votes", () => {
    const text = { key: { id: "T", remoteJid: GROUP }, message: { conversation: "hi" } } as WAMessage;
    expect(readPollCreation(text, [SELF_PN])).toBeUndefined();
    expect(readPollVote(text)).toBeUndefined();
  });
});
