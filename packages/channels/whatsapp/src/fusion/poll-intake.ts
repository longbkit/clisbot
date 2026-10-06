// The inbox's poll half (D-WA-030): remember every poll the account sends or
// sees, and turn a vote into a `poll_answer` event for the Hub.
import type { WAMessage } from "baileys";
import type { ChannelInboundEvent, HostChildLogger, HostKeyedStore } from "@clisbot/channels-shared";
import { readWhatsAppBaileysCacheEntry, type WhatsAppBaileysMessageCache } from "../inbound/baileys-cache.js";
import type { WhatsAppSendResult } from "../inbound/send-result.js";
import { buildWhatsAppPollAnswerEvent } from "./inbound-adapter.js";
import { decodePollVote, readPollCreation, readPollVote, type StoredWhatsAppPoll } from "./polls.js";

export interface WhatsAppPollIntakeOptions {
  accountId: string;
  polls: HostKeyedStore<StoredWhatsAppPoll>;
  /** The linked account's own JID spellings (phone JID, LID). */
  selfJids: () => Array<string | null | undefined>;
  /** A voter JID → the sender id the Hub sees (E.164 when known). */
  resolveVoterId: (jid: string) => Promise<string | null>;
  admit: (event: ChannelInboundEvent) => Promise<boolean>;
  logger?: HostChildLogger;
}

export function createWhatsAppPollIntake(options: WhatsAppPollIntakeOptions) {
  const store = async (msg: Pick<WAMessage, "key" | "message">) => {
    const created = readPollCreation(msg, options.selfJids());
    if (!created) return;
    await options.polls.register(created.id, created.poll).catch((error: unknown) => {
      options.logger?.warn(`[${options.accountId}] could not store WhatsApp poll ${created.id}: ${String(error)}`);
    });
  };

  /** A poll this account just sent: the socket cached the sent message, secret included. */
  const rememberSent = async (result: WhatsAppSendResult, cache: WhatsAppBaileysMessageCache) => {
    for (const key of result.keys) {
      if (!key.remoteJid || !key.id) continue;
      const message = readWhatsAppBaileysCacheEntry(cache, `${key.remoteJid}:${key.id}`);
      if (message) await store({ key: { id: key.id, remoteJid: key.remoteJid, fromMe: true }, message });
    }
  };

  /** True when `msg` was a vote (handled here, whether or not it decoded). */
  const handleVote = async (msg: WAMessage): Promise<boolean> => {
    const vote = readPollVote(msg);
    if (!vote) return false;
    const poll = await options.polls.lookup(vote.pollId);
    const decoded = poll && decodePollVote({ pollId: vote.pollId, poll, voterJids: vote.voterJids, vote: vote.vote });
    if (!decoded) {
      options.logger?.warn(
        `[${options.accountId}] WhatsApp poll vote for ${vote.pollId} not decoded (${poll ? "no JID spelling verified" : "unknown poll"})`,
      );
      return true;
    }
    const voterJid = vote.voterJids[0] ?? "";
    const voterId = (await options.resolveVoterId(voterJid)) ?? voterJid;
    const build = buildWhatsAppPollAnswerEvent({
      msg,
      vote: decoded,
      voterId,
      group: decoded.chatJid.endsWith("@g.us"),
    });
    if (build.admit) await options.admit(build.event);
    return true;
  };

  return { store, rememberSent, handleVote } as const;
}
